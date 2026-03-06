#!/usr/bin/env node

/**
 * LGR-004: Skip/Only Test Guard
 *
 * Validates that .skip and .only test modifiers are not committed to main
 * unless explicitly allowed via allowlist with issue ID and expiry date.
 *
 * Usage:
 *   node scripts/validate-skip-only.mjs [files...]
 *
 * Exit codes:
 *   0 - No violations found
 *   1 - Violations found or validation error
 */

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

// Patterns to detect skip/only markers
const SKIP_ONLY_PATTERNS = [
  /\b(it|test|describe)\.only\(/g,
  /\b(it|test|describe)\.skip\(/g,
  /\btest\.each\.only\(/g,
  /\bdescribe\.each\.only\(/g,
];

// Allowlist file path
const ALLOWLIST_PATH = resolve(process.cwd(), ".skip-only-allowlist.json");

/**
 * Load and parse allowlist
 * @returns {Array<{path: string, issueId: string, expiryDate: string, reason: string}>}
 */
function loadAllowlist() {
  try {
    const content = readFileSync(ALLOWLIST_PATH, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return []; // No allowlist file = no allowed entries
    }
    throw error;
  }
}

/**
 * Check if a file path is allowed by the allowlist
 * @param {string} filePath
 * @param {Array} allowlist
 * @returns {{allowed: boolean, expired: boolean, entry: object | null}}
 */
function checkAllowlist(filePath, allowlist) {
  // Normalize to relative path for comparison with allowlist
  const normalizedPath = relative(process.cwd(), resolve(filePath));
  const entry = allowlist.find((item) => item.path === normalizedPath);

  if (!entry) {
    return { allowed: false, expired: false, entry: null };
  }

  // Validate required fields
  if (!entry.issueId || !entry.expiryDate) {
    console.error(
      `ERROR: Allowlist entry for ${filePath} missing required fields (issueId, expiryDate)`,
    );
    return { allowed: false, expired: false, entry };
  }

  // Check if expired
  const expiryDate = new Date(entry.expiryDate);
  const now = new Date();

  if (Number.isNaN(expiryDate.getTime())) {
    console.error(`ERROR: Invalid expiry date format for ${filePath}: ${entry.expiryDate}`);
    return { allowed: false, expired: false, entry };
  }

  if (expiryDate < now) {
    return { allowed: false, expired: true, entry };
  }

  return { allowed: true, expired: false, entry };
}

/**
 * Scan a file for skip/only markers
 * @param {string} filePath
 * @returns {Array<{line: number, match: string}>}
 */
function scanFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of SKIP_ONLY_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex state
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
}

/**
 * Main validation function
 */
function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    console.log("No files to check");
    return;
  }

  // Only check test files
  const testFiles = files.filter(
    (file) =>
      file.includes("__tests__") ||
      file.endsWith(".test.ts") ||
      file.endsWith(".test.js") ||
      file.endsWith(".spec.ts") ||
      file.endsWith(".spec.js"),
  );

  if (testFiles.length === 0) {
    console.log("No test files to check");
    return;
  }

  const allowlist = loadAllowlist();
  let hasViolations = false;

  for (const file of testFiles) {
    const violations = scanFile(file);

    if (violations.length === 0) {
      continue;
    }

    // Check allowlist
    const { allowed, expired, entry } = checkAllowlist(file, allowlist);

    if (allowed) {
      console.log(
        `ℹ️  ${file}: ${violations.length} skip/only marker(s) found (allowed via issue ${entry.issueId} until ${entry.expiryDate})`,
      );
      continue;
    }

    // Report violations
    hasViolations = true;

    if (expired) {
      console.error(`\n❌ ${file}: Allowlist entry EXPIRED on ${entry.expiryDate}`);
      console.error(`   Issue: ${entry.issueId}`);
      console.error(`   Reason: ${entry.reason || "N/A"}`);
    } else {
      console.error(`\n❌ ${file}: Skip/only modifiers detected`);
    }

    for (const violation of violations) {
      console.error(`   Line ${violation.line}: ${violation.match}`);
    }

    console.error("\nSkip/only modifiers are not allowed in committed code.");
    console.error("Options:");
    console.error("  1. Remove the modifier and fix the test before committing");
    console.error("  2. Move failing tests to __tests__/quarantine/ with tracking issue");
    console.error(
      "  3. Add to .skip-only-allowlist.json with issue ID and expiry date (max 14 days)",
    );
    console.error("\nSee Q-005 in quality/challenge-questions.md for policy.");
  }

  if (hasViolations) {
    process.exit(1);
  }

  console.log("✅ No skip/only violations found");
}

main();
