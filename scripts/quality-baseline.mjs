#!/usr/bin/env node

import { execFile as execFileCb } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const tempDir = path.join(repoRoot, ".quality", "tmp");
const outputDir = path.join(repoRoot, "quality");
const outputPath = path.join(outputDir, "baseline.v1.json");

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

function countDiagnosticsFromText(output, exitCode) {
  const summaryMatch = output.match(/Summary:\s*(\d+)\s+error\(s\)/u);
  if (summaryMatch) {
    return Number(summaryMatch[1]);
  }

  if (exitCode === 0) {
    return 0;
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

async function main() {
  await rm(path.join(repoRoot, ".quality"), { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  const commitSha = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
  const generationTimestamp = (
    await run("git", ["show", "-s", "--format=%cI", commitSha])
  ).stdout.trim();

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

  const baseline = {
    schemaVersion: "1.0.0",
    commitSha,
    generationTimestamp,
    lintDiagnosticsBySeverity,
    skippedTests: tests.skipped,
    flakyTests: tests.flaky,
    coverageByPackage: Object.fromEntries(
      Object.entries(coverageByPackage).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };

  await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  await rm(path.join(repoRoot, ".quality"), { recursive: true, force: true });
  process.stdout.write(`Wrote quality baseline: ${path.relative(repoRoot, outputPath)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
