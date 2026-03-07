#!/usr/bin/env node

/**
 * Check no-new-debt rule (MIG-002)
 *
 * This script enforces that new code changes don't introduce quality violations
 * beyond the locked baseline (quality/baseline.v1.json).
 *
 * Acceptance Criteria:
 * 1. CI diff-aware checks identify new violations not present in the baseline
 * 2. Existing baseline violations outside changed scope remain visible but non-blocking
 * 3. New violations in changed files/scope FAIL CI
 * 4. Checks compare current state against locked baseline
 *
 * Exit codes:
 *   0 - No new violations (CI passes)
 *   1 - New violations detected (CI fails)
 */

import { execFile as execFileCb } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const tempDir = path.join(repoRoot, ".quality", "tmp");
const baselineFile = path.join(repoRoot, "quality", "baseline.v1.json");

const BASE_BRANCH = process.env.BASE_BRANCH || "main";
const COVERAGE_TOLERANCE = 0.1; // Allow 0.1% rounding tolerance

async function run(command, args, { allowFailure = false } = {}) {
  try {
    const result = await execFile(command, args, {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    const code = Number.isInteger(error.code) ? error.code : 1;
    const stdout = error.stdout ?? "";
    const stderr = error.stderr ?? "";
    if (!allowFailure) {
      throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stdout}${stderr}`);
    }
    return { code, stdout, stderr };
  }
}

function countDiagnosticsFromText(output) {
  const summaryMatch = output.match(/Summary:\s*(\d+)\s+error\(s\)/u);
  if (summaryMatch) {
    return Number(summaryMatch[1]);
  }

  return output
    .split(/\r?\n/u)
    .filter((line) => /\berror\b/iu.test(line) || /^\s*\S[^:]*:\d+/u.test(line)).length;
}

function parseBiome(jsonText) {
  try {
    const payload = JSON.parse(jsonText);
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    const counts = { error: 0, warning: 0, info: 0 };
    for (const diagnostic of diagnostics) {
      const severity = String(diagnostic?.severity ?? "error").toLowerCase();
      if (severity === "warning") counts.warning += 1;
      else if (severity === "information" || severity === "info") counts.info += 1;
      else counts.error += 1;
    }
    return counts;
  } catch {
    return { error: 0, warning: 0, info: 0 };
  }
}

function parseVitestReport(payload) {
  let skipped = Number(payload?.numSkippedTests ?? 0);
  let flaky = 0;
  const stack = [payload];

  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    if (item.result?.flaky === true) flaky += 1;
    if (item.mode === "skip") skipped += 1;

    for (const value of Object.values(item)) {
      if (Array.isArray(value)) {
        for (const child of value) stack.push(child);
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return { skipped, flaky };
}

function metric() {
  return { covered: 0, total: 0, pct: 100 };
}

function addMetric(existing, covered, total) {
  const nextCovered = existing.covered + covered;
  const nextTotal = existing.total + total;
  return {
    covered: nextCovered,
    total: nextTotal,
    pct: nextTotal === 0 ? 100 : Number(((nextCovered / nextTotal) * 100).toFixed(2)),
  };
}

/**
 * Get list of packages with changed files using git diff
 * @returns {Set<string>} Set of package names (e.g., 'core', 'cli')
 */
async function getChangedPackages() {
  try {
    const result = await run("git", ["diff", `${BASE_BRANCH}...HEAD`, "--name-only"], {
      allowFailure: true,
    });

    if (result.code !== 0 || !result.stdout.trim()) {
      // If diff fails or is empty (e.g., comparing same branch), check all packages
      return null; // null means "check all packages"
    }

    const changedFiles = result.stdout.trim().split("\n");
    const packages = new Set();

    for (const file of changedFiles) {
      const match = file.match(/^packages\/([^/]+)\//);
      if (match) {
        packages.add(match[1]);
      }
    }

    return packages;
  } catch {
    // On error, fall back to checking all packages
    return null;
  }
}

async function getCurrentMetrics() {
  await rm(path.join(repoRoot, ".quality"), { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  // Get lint metrics
  const biome = await run("pnpm", ["run", "lint:biome", "--", "--reporter=json"], {
    allowFailure: true,
  });
  const md = await run("pnpm", ["run", "lint:md"], { allowFailure: true });
  const yaml = await run("pnpm", ["run", "lint:yaml"], { allowFailure: true });
  const frontmatter = await run("pnpm", ["run", "lint:frontmatter"], { allowFailure: true });

  const biomeCounts = parseBiome(biome.stdout);
  const lintDiagnosticsBySeverity = {
    error:
      biomeCounts.error +
      countDiagnosticsFromText(`${md.stdout}\n${md.stderr}`) +
      countDiagnosticsFromText(`${yaml.stdout}\n${yaml.stderr}`) +
      countDiagnosticsFromText(`${frontmatter.stdout}\n${frontmatter.stderr}`),
    warning: biomeCounts.warning,
    info: biomeCounts.info,
  };

  // Get test metrics
  const vitestReportPath = path.join(tempDir, "vitest-report.json");
  await run("pnpm", [
    "exec",
    "vitest",
    "run",
    "--reporter=json",
    `--outputFile=${vitestReportPath}`,
  ]);
  const vitestReport = JSON.parse(await readFile(vitestReportPath, "utf8"));
  const tests = parseVitestReport(vitestReport);

  // Get coverage metrics
  const coverageDir = path.join(tempDir, "coverage");
  await mkdir(path.join(coverageDir, ".tmp"), { recursive: true });
  await run("pnpm", [
    "exec",
    "vitest",
    "run",
    "--coverage.enabled=true",
    "--coverage.provider=v8",
    "--coverage.reporter=json-summary",
    `--coverage.reportsDirectory=${coverageDir}`,
  ]);

  const coverageSummary = JSON.parse(
    await readFile(path.join(coverageDir, "coverage-summary.json"), "utf8"),
  );

  const coverageByPackage = {};
  for (const [fileName, m] of Object.entries(coverageSummary)) {
    if (fileName === "total") continue;

    const normalized = String(fileName).split(path.sep).join("/");
    const match = normalized.match(/packages\/([^/]+)\//u);
    if (!match) continue;
    const packageName = match[1];

    if (!coverageByPackage[packageName]) {
      coverageByPackage[packageName] = {
        lines: metric(),
        statements: metric(),
        functions: metric(),
        branches: metric(),
      };
    }

    coverageByPackage[packageName].lines = addMetric(
      coverageByPackage[packageName].lines,
      Number(m?.lines?.covered ?? 0),
      Number(m?.lines?.total ?? 0),
    );
    coverageByPackage[packageName].statements = addMetric(
      coverageByPackage[packageName].statements,
      Number(m?.statements?.covered ?? 0),
      Number(m?.statements?.total ?? 0),
    );
    coverageByPackage[packageName].functions = addMetric(
      coverageByPackage[packageName].functions,
      Number(m?.functions?.covered ?? 0),
      Number(m?.functions?.total ?? 0),
    );
    coverageByPackage[packageName].branches = addMetric(
      coverageByPackage[packageName].branches,
      Number(m?.branches?.covered ?? 0),
      Number(m?.branches?.total ?? 0),
    );
  }

  await rm(path.join(repoRoot, ".quality"), { recursive: true, force: true });

  return {
    lintDiagnosticsBySeverity,
    skippedTests: tests.skipped,
    flakyTests: tests.flaky,
    coverageByPackage,
  };
}

async function main() {
  console.log("🔍 Checking no-new-debt rule (MIG-002)...\n");

  // Load baseline
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselineFile, "utf8"));
  } catch (error) {
    console.error(`❌ Failed to load baseline: ${baselineFile}`);
    console.error(`   ${error.message}`);
    console.error("\n💡 Run 'pnpm run quality:baseline' to generate baseline");
    process.exit(1);
  }

  console.log(`📊 Baseline: ${baseline.commitSha.slice(0, 7)} (${baseline.generationTimestamp})\n`);

  // Get changed packages for diff-aware coverage checks
  const changedPackages = await getChangedPackages();
  if (changedPackages === null) {
    console.log("⚠️  Cannot determine changed files - will check all packages\n");
  } else if (changedPackages.size === 0) {
    console.log("✅ No package files changed - skipping coverage regression checks\n");
  } else {
    console.log(`📝 Changed packages: ${[...changedPackages].join(", ")}\n`);
  }

  // Get current metrics
  console.log("🔄 Collecting current metrics...\n");
  const current = await getCurrentMetrics();

  // Track violations
  const newViolations = [];
  const baselineViolations = [];

  // Check lint errors (global, not diff-aware)
  if (current.lintDiagnosticsBySeverity.error > baseline.lintDiagnosticsBySeverity.error) {
    newViolations.push({
      type: "Lint Errors",
      baseline: baseline.lintDiagnosticsBySeverity.error,
      current: current.lintDiagnosticsBySeverity.error,
      delta: current.lintDiagnosticsBySeverity.error - baseline.lintDiagnosticsBySeverity.error,
    });
  } else if (baseline.lintDiagnosticsBySeverity.error > 0) {
    baselineViolations.push({
      type: "Lint Errors",
      count: baseline.lintDiagnosticsBySeverity.error,
    });
  }

  // Check lint warnings (global, not diff-aware)
  if (current.lintDiagnosticsBySeverity.warning > baseline.lintDiagnosticsBySeverity.warning) {
    newViolations.push({
      type: "Lint Warnings",
      baseline: baseline.lintDiagnosticsBySeverity.warning,
      current: current.lintDiagnosticsBySeverity.warning,
      delta: current.lintDiagnosticsBySeverity.warning - baseline.lintDiagnosticsBySeverity.warning,
    });
  } else if (baseline.lintDiagnosticsBySeverity.warning > 0) {
    baselineViolations.push({
      type: "Lint Warnings",
      count: baseline.lintDiagnosticsBySeverity.warning,
    });
  }

  // Check skipped tests (global, not diff-aware)
  if (current.skippedTests > baseline.skippedTests) {
    newViolations.push({
      type: "Skipped Tests",
      baseline: baseline.skippedTests,
      current: current.skippedTests,
      delta: current.skippedTests - baseline.skippedTests,
    });
  } else if (baseline.skippedTests > 0) {
    baselineViolations.push({
      type: "Skipped Tests",
      count: baseline.skippedTests,
    });
  }

  // Check flaky tests (global, not diff-aware)
  if (current.flakyTests > baseline.flakyTests) {
    newViolations.push({
      type: "Flaky Tests",
      baseline: baseline.flakyTests,
      current: current.flakyTests,
      delta: current.flakyTests - baseline.flakyTests,
    });
  } else if (baseline.flakyTests > 0) {
    baselineViolations.push({
      type: "Flaky Tests",
      count: baseline.flakyTests,
    });
  }

  // Check coverage regressions (diff-aware per package)
  if (changedPackages === null || changedPackages.size > 0) {
    for (const [packageName, baselineCoverage] of Object.entries(baseline.coverageByPackage)) {
      // If we know which packages changed, only check those
      if (changedPackages !== null && !changedPackages.has(packageName)) {
        continue;
      }

      const currentCoverage = current.coverageByPackage[packageName];
      if (!currentCoverage) {
        // Package was removed or coverage data missing
        continue;
      }

      // Check each metric type
      for (const metricType of ["lines", "statements", "functions", "branches"]) {
        const baselinePct = baselineCoverage[metricType].pct;
        const currentPct = currentCoverage[metricType].pct;
        const delta = currentPct - baselinePct;

        // Allow tolerance for rounding
        if (delta < -COVERAGE_TOLERANCE) {
          newViolations.push({
            type: `Coverage Regression: ${packageName} (${metricType})`,
            baseline: `${baselinePct.toFixed(2)}%`,
            current: `${currentPct.toFixed(2)}%`,
            delta: `${delta.toFixed(2)}%`,
          });
        }
      }
    }
  }

  // Report results
  console.log("═".repeat(80));

  if (baselineViolations.length > 0) {
    console.log("\n📊 EXISTING BASELINE VIOLATIONS (non-blocking):\n");
    for (const v of baselineViolations) {
      console.log(`  ⚠️  ${v.type} (baseline): ${v.count}`);
    }
  }

  if (newViolations.length > 0) {
    console.log("\n❌ NEW VIOLATIONS DETECTED (blocking):\n");
    for (const v of newViolations) {
      console.log(`  ❌ ${v.type}`);
      console.log(`     Baseline: ${v.baseline}`);
      console.log(`     Current:  ${v.current}`);
      console.log(`     Delta:    ${typeof v.delta === "number" ? `+${v.delta}` : v.delta}`);
      console.log();
    }

    console.log("═".repeat(80));
    console.log("\n🚫 CI FAILED: New quality violations detected\n");
    console.log("To resolve:");
    console.log("  1. Fix the violations above");
    console.log("  2. Or update baseline if this is intentional: pnpm run quality:baseline");
    console.log("  3. Commit the changes\n");

    process.exit(1);
  }

  console.log("\n✅ NO NEW VIOLATIONS");
  console.log("   All quality metrics maintained or improved\n");

  if (baselineViolations.length > 0) {
    console.log("   Note: Existing baseline violations should be tracked in quality/gaps.md\n");
  }

  console.log("═".repeat(80));
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(
    `\n❌ Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
