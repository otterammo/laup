#!/usr/bin/env node

/**
 * CIG-008: Skip/Flake Report Generator
 *
 * Generates metrics and dashboard data for skipped and quarantined tests.
 *
 * Usage:
 *   node scripts/generate-skip-flake-report.mjs [--output path]
 *
 * Exit codes:
 *   0 - Report generated successfully
 *   1 - Error generating report
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ALLOWLIST_PATH = ".skip-only-allowlist.json";
const QUARANTINE_MANIFEST = ".quarantine-manifest.json";
const DEFAULT_OUTPUT = "quality/skip-flake-latest.json";
const HISTORY_DIR = "quality/skip-flake-history";

// Patterns to detect skip/only markers
const SKIP_ONLY_PATTERNS = [
  /\b(it|test|describe)\.only\(/g,
  /\b(it|test|describe)\.skip\(/g,
  /\btest\.each\.only\(/g,
  /\bdescribe\.each\.only\(/g,
];

/**
 * Recursively find all test files
 */
function findTestFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      if (file === "node_modules" || file === ".git" || file === "coverage" || file === "dist") {
        continue;
      }
      findTestFiles(filePath, fileList);
    } else if (
      file.endsWith(".test.ts") ||
      file.endsWith(".test.js") ||
      file.endsWith(".spec.ts") ||
      file.endsWith(".spec.js") ||
      filePath.includes("__tests__")
    ) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * Scan a file for skip/only markers
 */
function scanFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of SKIP_ONLY_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = [...line.matchAll(pattern)];

        for (const match of matches) {
          violations.push({
            line: i + 1,
            match: match[0],
          });
        }
      }
    }

    return violations;
  } catch (_error) {
    return [];
  }
}

/**
 * Load allowlist
 */
function loadAllowlist() {
  try {
    if (!existsSync(ALLOWLIST_PATH)) {
      return [];
    }
    const content = readFileSync(ALLOWLIST_PATH, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`ERROR: Failed to parse allowlist: ${error.message}`);
    return [];
  }
}

/**
 * Find all quarantine directories
 */
function findQuarantineDirectories(dir, results = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      if (file === "node_modules" || file === ".git" || file === "coverage" || file === "dist") {
        continue;
      }

      if (file === "quarantine" && dir.includes("__tests__")) {
        const manifestPath = join(filePath, QUARANTINE_MANIFEST);
        results.push({ dir: filePath, manifestPath });
      }

      findQuarantineDirectories(filePath, results);
    }
  }

  return results;
}

/**
 * Load quarantine manifest
 */
function loadManifest(manifestPath) {
  try {
    if (!existsSync(manifestPath)) {
      return null;
    }
    const content = readFileSync(manifestPath, "utf-8");
    return JSON.parse(content);
  } catch (_error) {
    return null;
  }
}

/**
 * Calculate days until a date
 */
function daysUntil(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
}

/**
 * Determine status of a skip entry
 */
function getSkipStatus(expiryDate) {
  const days = daysUntil(expiryDate);
  if (days < 0) return "expired";
  if (days <= 3) return "expiring-soon";
  return "valid";
}

/**
 * Determine status of a quarantine entry
 */
function getQuarantineStatus(targetFixDate) {
  const days = daysUntil(targetFixDate);
  if (days < 0) return "overdue";
  if (days <= 3) return "due-soon";
  return "active";
}

/**
 * Generate report
 */
function generateReport() {
  console.log("CIG-008: Generating skip/flake report...\n");

  const timestamp = new Date().toISOString();
  const testFiles = findTestFiles(process.cwd());
  const allowlist = loadAllowlist();
  const quarantineDirs = findQuarantineDirectories(process.cwd());

  const report = {
    timestamp,
    summary: {
      totalSkipped: 0,
      skippedWithAllowlist: 0,
      skippedWithoutAllowlist: 0,
      expiredAllowlist: 0,
      totalQuarantined: 0,
      quarantinedOverdue: 0,
      quarantinedDueSoon: 0,
    },
    skippedTests: [],
    quarantinedTests: [],
    violations: [],
  };

  // Scan for skipped tests
  for (const file of testFiles) {
    const violations = scanFile(file);

    if (violations.length === 0) {
      continue;
    }

    const normalizedPath = relative(process.cwd(), file);
    const entry = allowlist.find((item) => item.path === normalizedPath);

    report.summary.totalSkipped++;

    if (entry?.issueId && entry.expiryDate) {
      const status = getSkipStatus(entry.expiryDate);
      const daysRemaining = daysUntil(entry.expiryDate);

      report.summary.skippedWithAllowlist++;

      if (status === "expired") {
        report.summary.expiredAllowlist++;
        report.violations.push({
          type: "expired-allowlist",
          path: normalizedPath,
          issueId: entry.issueId,
          expiryDate: entry.expiryDate,
          message: "Allowlist entry has expired",
        });
      }

      report.skippedTests.push({
        path: normalizedPath,
        issueId: entry.issueId,
        expiryDate: entry.expiryDate,
        daysUntilExpiry: daysRemaining,
        status,
        reason: entry.reason,
        violationCount: violations.length,
      });
    } else {
      report.summary.skippedWithoutAllowlist++;
      report.violations.push({
        type: "ungoverned-skip",
        path: normalizedPath,
        message: "Skip/only markers without allowlist entry",
        violationCount: violations.length,
      });

      report.skippedTests.push({
        path: normalizedPath,
        issueId: null,
        expiryDate: null,
        daysUntilExpiry: null,
        status: "ungoverned",
        reason: null,
        violationCount: violations.length,
      });
    }
  }

  // Scan quarantined tests
  for (const { dir, manifestPath } of quarantineDirs) {
    const manifest = loadManifest(manifestPath);

    if (!manifest || !manifest.tests) {
      continue;
    }

    for (const entry of manifest.tests) {
      report.summary.totalQuarantined++;

      const status = getQuarantineStatus(entry.targetFixDate);
      const daysRemaining = daysUntil(entry.targetFixDate);

      if (status === "overdue") {
        report.summary.quarantinedOverdue++;
        report.violations.push({
          type: "overdue-quarantine",
          path: join(relative(process.cwd(), dir), entry.path),
          issueId: entry.issueId,
          targetFixDate: entry.targetFixDate,
          owner: entry.owner,
          message: "Quarantined test is overdue for remediation",
        });
      } else if (status === "due-soon") {
        report.summary.quarantinedDueSoon++;
      }

      report.quarantinedTests.push({
        path: join(relative(process.cwd(), dir), entry.path),
        issueId: entry.issueId,
        owner: entry.owner,
        quarantinedAt: entry.quarantinedAt,
        targetFixDate: entry.targetFixDate,
        daysUntilDeadline: daysRemaining,
        status,
        reason: entry.reason,
      });
    }
  }

  return report;
}

/**
 * Save report to file
 */
function saveReport(report, outputPath) {
  // Ensure directory exists
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Save latest report
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Report saved to ${outputPath}`);

  // Save historical snapshot
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }

  const date = new Date().toISOString().split("T")[0];
  const historyPath = join(HISTORY_DIR, `${date}.json`);
  writeFileSync(historyPath, JSON.stringify(report, null, 2));
  console.log(`📊 Historical snapshot saved to ${historyPath}`);
}

/**
 * Print summary to console
 */
function printSummary(report) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("SKIP/FLAKE REPORT SUMMARY");
  console.log("=".repeat(60));

  console.log("\nSkipped Tests:");
  console.log(`  Total: ${report.summary.totalSkipped}`);
  console.log(`  With allowlist: ${report.summary.skippedWithAllowlist}`);
  console.log(`  Without allowlist: ${report.summary.skippedWithoutAllowlist}`);
  console.log(`  Expired allowlist: ${report.summary.expiredAllowlist}`);

  console.log("\nQuarantined Tests:");
  console.log(`  Total: ${report.summary.totalQuarantined}`);
  console.log(`  Overdue: ${report.summary.quarantinedOverdue}`);
  console.log(`  Due soon (<3 days): ${report.summary.quarantinedDueSoon}`);

  if (report.violations.length > 0) {
    console.log(`\n⚠️  Violations: ${report.violations.length}`);
    for (const violation of report.violations) {
      console.log(`  - ${violation.type}: ${violation.path}`);
    }
  } else {
    console.log("\n✅ No violations found");
  }

  console.log("=".repeat(60));
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  let outputPath = DEFAULT_OUTPUT;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    }
  }

  try {
    const report = generateReport();
    printSummary(report);
    saveReport(report, outputPath);
  } catch (error) {
    console.error(`\n❌ Error generating report: ${error.message}`);
    process.exit(1);
  }
}

main();
