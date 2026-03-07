#!/usr/bin/env node

/**
 * Check diff coverage for changed lines in a PR
 *
 * This script:
 * 1. Identifies changed lines using git diff
 * 2. Parses coverage report
 * 3. Calculates coverage for changed lines only
 * 4. Exits with error code if below threshold (default 90%)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const THRESHOLD = Number.parseInt(process.env.DIFF_COVERAGE_THRESHOLD || "90", 10);
const BASE_BRANCH = process.env.BASE_BRANCH || "main";
const COVERAGE_DIR = "coverage";

/**
 * Parse git diff output to get changed line ranges
 * @returns {Map<string, Set<number>>} Map of file paths to set of changed line numbers
 */
function getChangedLines() {
  try {
    // Get unified diff with line numbers
    const diffOutput = execSync(`git diff ${BASE_BRANCH}...HEAD --unified=0 --diff-filter=ACMR`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).toString();

    const changedLines = new Map();
    let currentFile = null;

    for (const line of diffOutput.split("\n")) {
      // Match file path: +++ b/packages/core/src/index.ts
      const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        // Only track TypeScript files in packages
        if (currentFile.match(/^packages\/.*\.ts$/) && !currentFile.includes("__tests__")) {
          changedLines.set(currentFile, new Set());
        }
        continue;
      }

      // Match hunk header: @@ -10,5 +10,8 @@
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch && currentFile && changedLines.has(currentFile)) {
        const startLine = Number.parseInt(hunkMatch[1], 10);
        const lineCount = hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1;

        // Add all lines in this hunk
        for (let i = 0; i < lineCount; i++) {
          changedLines.get(currentFile).add(startLine + i);
        }
      }
    }

    // Remove files with no changed lines
    for (const [file, lines] of changedLines.entries()) {
      if (lines.size === 0) {
        changedLines.delete(file);
      }
    }

    return changedLines;
  } catch (error) {
    console.error("Error getting changed lines:", error.message);
    return new Map();
  }
}

/**
 * Parse coverage report from vitest JSON output
 * @returns {Map<string, object>} Map of file paths to coverage data
 */
function getCoverageData() {
  const coverageFile = join(COVERAGE_DIR, "coverage-final.json");

  if (!existsSync(coverageFile)) {
    console.error(`Coverage file not found: ${coverageFile}`);
    console.error("Run 'pnpm run test:run --coverage' first");
    process.exit(1);
  }

  try {
    const coverage = JSON.parse(readFileSync(coverageFile, "utf-8"));
    return new Map(Object.entries(coverage));
  } catch (error) {
    console.error("Error parsing coverage data:", error.message);
    process.exit(1);
  }
}

/**
 * Calculate coverage for specific lines in a file
 * @param {object} fileCoverage - Coverage data for a file
 * @param {Set<number>} lines - Line numbers to check
 * @returns {{covered: number, total: number}}
 */
function calculateLineCoverage(fileCoverage, lines) {
  const statementMap = fileCoverage.statementMap || {};
  const statements = fileCoverage.s || {};

  let covered = 0;
  let total = 0;

  // Check each statement
  for (const [stmtId, location] of Object.entries(statementMap)) {
    const startLine = location.start.line;
    const endLine = location.end.line;

    // Check if this statement overlaps with changed lines
    let isChanged = false;
    for (let line = startLine; line <= endLine; line++) {
      if (lines.has(line)) {
        isChanged = true;
        break;
      }
    }

    if (isChanged) {
      total++;
      if (statements[stmtId] > 0) {
        covered++;
      }
    }
  }

  return { covered, total };
}

/**
 * Calculate and report diff coverage
 */
function main() {
  console.log("🔍 Checking diff coverage...\n");

  const changedLines = getChangedLines();

  if (changedLines.size === 0) {
    console.log("✅ No relevant files changed (or comparing against same branch)");
    process.exit(0);
  }

  console.log(`📝 Changed files: ${changedLines.size}\n`);

  const coverageData = getCoverageData();

  let totalCovered = 0;
  let totalStatements = 0;
  const fileResults = [];

  // Calculate coverage for each changed file
  for (const [file, lines] of changedLines.entries()) {
    // Try to find matching coverage data
    // Coverage paths are absolute, so we need to match by file path ending
    let fileCoverage = null;
    for (const [covPath, covData] of coverageData.entries()) {
      if (covPath.endsWith(file)) {
        fileCoverage = covData;
        break;
      }
    }

    if (!fileCoverage) {
      console.log(`⚠️  No coverage data for: ${file}`);
      fileResults.push({
        file,
        covered: 0,
        total: lines.size,
        percentage: 0,
      });
      totalStatements += lines.size;
      continue;
    }

    const { covered, total } = calculateLineCoverage(fileCoverage, lines);
    const percentage = total > 0 ? (covered / total) * 100 : 100;

    fileResults.push({
      file,
      covered,
      total,
      percentage,
    });

    totalCovered += covered;
    totalStatements += total;
  }

  // Report results
  console.log("📊 Coverage by file:\n");
  for (const result of fileResults) {
    const status = result.percentage >= THRESHOLD ? "✅" : "❌";
    const pct = result.total > 0 ? result.percentage.toFixed(1) : "N/A";
    console.log(`${status} ${result.file}: ${pct}% (${result.covered}/${result.total} statements)`);
  }

  const overallPercentage = totalStatements > 0 ? (totalCovered / totalStatements) * 100 : 100;

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `📈 Overall diff coverage: ${overallPercentage.toFixed(1)}% (${totalCovered}/${totalStatements} statements)`,
  );
  console.log(`🎯 Threshold: ${THRESHOLD}%`);

  if (overallPercentage >= THRESHOLD) {
    console.log("\n✅ Diff coverage check passed!");
    process.exit(0);
  } else {
    console.log("\n❌ Diff coverage check failed!");
    console.log(`   Coverage is ${(THRESHOLD - overallPercentage).toFixed(1)}% below threshold`);
    process.exit(1);
  }
}

main();
