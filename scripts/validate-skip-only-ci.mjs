#!/usr/bin/env node

/**
 * CIG-008: Skip/Only Test Guard (CI Version)
 *
 * Validates that .skip and .only test modifiers are not committed to main
 * unless explicitly allowed via allowlist with issue ID and expiry date.
 *
 * Unlike LGR-004 (pre-commit), this checks ALL test files in the repository
 * to catch expired allowlist entries and ensure governance compliance.
 *
 * Usage:
 *   node scripts/validate-skip-only-ci.mjs
 *
 * Exit codes:
 *   0 - No violations found
 *   1 - Violations found or validation error
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Patterns to detect skip/only markers
const SKIP_ONLY_PATTERNS = [
  /\b(it|test|describe)\.only\(/g,
  /\b(it|test|describe)\.skip\(/g,
  /\btest\.each\.only\(/g,
  /\bdescribe\.each\.only\(/g,
];

// Allowlist file path
const ALLOWLIST_PATH = ".skip-only-allowlist.json";

/**
 * Recursively find all test files in the repository
 * @param {string} dir
 * @param {string[]} fileList
 * @returns {string[]}
 */
function findTestFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules, .git, coverage, and dist directories
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
 * Load and parse allowlist
 * @returns {Array<{path: string, issueId: string, expiryDate: string, reason: string}>}
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
  // Normalize to relative path for comparison
  const normalizedPath = relative(process.cwd(), filePath);
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
  try {
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
  } catch (error) {
    console.error(`ERROR: Failed to read ${filePath}: ${error.message}`);
    return [];
  }
}

/**
 * Main validation function
 */
function main() {
  console.log("CIG-008: Validating skip/only markers across all test files...\n");

  // Find all test files
  const testFiles = findTestFiles(process.cwd());

  if (testFiles.length === 0) {
    console.log("No test files found");
    return;
  }

  console.log(`Found ${testFiles.length} test files to validate\n`);

  const allowlist = loadAllowlist();
  let hasViolations = false;
  let allowedCount = 0;

  for (const file of testFiles) {
    const violations = scanFile(file);

    if (violations.length === 0) {
      continue;
    }

    // Check allowlist
    const { allowed, expired, entry } = checkAllowlist(file, allowlist);

    if (allowed) {
      allowedCount++;
      console.log(
        `ℹ️  ${relative(process.cwd(), file)}: ${violations.length} skip/only marker(s) found (allowed via issue ${entry.issueId} until ${entry.expiryDate})`,
      );
      continue;
    }

    // Report violations
    hasViolations = true;

    if (expired) {
      console.error(
        `\n❌ ${relative(process.cwd(), file)}: Allowlist entry EXPIRED on ${entry.expiryDate}`,
      );
      console.error(`   Issue: ${entry.issueId}`);
      console.error(`   Reason: ${entry.reason || "N/A"}`);
    } else {
      console.error(`\n❌ ${relative(process.cwd(), file)}: Skip/only modifiers detected`);
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

  console.log(
    `\n📊 Summary: ${testFiles.length} test files scanned, ${allowedCount} allowed via allowlist`,
  );

  if (hasViolations) {
    console.error("\n❌ CIG-008: Skip/only governance validation FAILED");
    process.exit(1);
  }

  console.log("✅ CIG-008: No skip/only violations found");
}

main();
