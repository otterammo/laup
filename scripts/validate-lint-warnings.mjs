#!/usr/bin/env node

/**
 * CIG-002: Lint Must Hard-Fail on Strict Diagnostics
 *
 * Validates that Biome lint warnings are properly tracked and allowed only
 * with explicit exceptions in .lint-warnings-allowlist.json.
 *
 * Usage:
 *   node scripts/validate-lint-warnings.mjs
 *
 * Exit codes:
 *   0 - No violations found
 *   1 - Violations found or validation error
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// Allowlist file path
const ALLOWLIST_PATH = resolve(process.cwd(), ".lint-warnings-allowlist.json");

// Maximum exception duration in days
const MAX_EXCEPTION_DAYS = 90;

// Minimum justification length
const MIN_JUSTIFICATION_LENGTH = 10;

/**
 * Load and parse allowlist
 * @returns {Array<{file: string, rule: string, justification: string, approver: string, approvalDate: string, expiryDate: string, trackingIssue: string}>}
 */
function loadAllowlist() {
  try {
    const content = readFileSync(ALLOWLIST_PATH, "utf-8");
    const parsed = JSON.parse(content);
    
    if (!Array.isArray(parsed)) {
      throw new Error("Allowlist must be an array");
    }
    
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return []; // No allowlist file = no allowed entries
    }
    throw error;
  }
}

/**
 * Validate a single allowlist entry
 * @param {object} entry
 * @param {number} index
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateEntry(entry, index) {
  const errors = [];
  const entryLabel = `Entry ${index + 1}`;

  // Required fields
  const requiredFields = ["file", "rule", "justification", "approver", "approvalDate", "expiryDate", "trackingIssue"];
  for (const field of requiredFields) {
    if (!entry[field]) {
      errors.push(`${entryLabel}: Missing required field '${field}'`);
    }
  }

  // If missing required fields, return early
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate file path (must be relative)
  if (isAbsolute(entry.file)) {
    errors.push(`${entryLabel}: File path must be relative, not absolute: ${entry.file}`);
  }

  // Validate rule format (should be category/ruleName)
  if (!entry.rule.includes("/")) {
    errors.push(`${entryLabel}: Rule format should be 'category/ruleName', got: ${entry.rule}`);
  }

  // Validate justification length
  if (entry.justification.length < MIN_JUSTIFICATION_LENGTH) {
    errors.push(`${entryLabel}: Justification is too short (minimum ${MIN_JUSTIFICATION_LENGTH} characters)`);
  }

  // Validate approver format (should start with @)
  if (!entry.approver.startsWith("@")) {
    errors.push(`${entryLabel}: Approver should start with '@', got: ${entry.approver}`);
  }

  // Validate tracking issue format (should be #123)
  if (!entry.trackingIssue.match(/^#\d+$/)) {
    errors.push(`${entryLabel}: Tracking issue should be in format '#123', got: ${entry.trackingIssue}`);
  }

  // Validate dates
  const approvalDate = new Date(entry.approvalDate);
  const expiryDate = new Date(entry.expiryDate);
  const now = new Date();

  if (Number.isNaN(approvalDate.getTime())) {
    errors.push(`${entryLabel}: Invalid approval date format: ${entry.approvalDate}`);
  }

  if (Number.isNaN(expiryDate.getTime())) {
    errors.push(`${entryLabel}: Invalid expiry date format: ${entry.expiryDate}`);
  }

  // Check if expired
  if (expiryDate < now) {
    errors.push(`${entryLabel}: Exception EXPIRED on ${entry.expiryDate} (file: ${entry.file}, rule: ${entry.rule})`);
  }

  // Check if exception period exceeds maximum
  const durationMs = expiryDate - approvalDate;
  const durationDays = durationMs / (1000 * 60 * 60 * 24);

  if (durationDays > MAX_EXCEPTION_DAYS) {
    errors.push(
      `${entryLabel}: Exception period exceeds ${MAX_EXCEPTION_DAYS} days (${Math.round(durationDays)} days): ${entry.file}`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Main validation function
 */
function main() {
  console.log("🔍 Validating lint warnings allowlist...");

  const allowlist = loadAllowlist();

  if (allowlist.length === 0) {
    console.log("✅ Allowlist is empty - no exceptions to validate");
    return;
  }

  console.log(`\nℹ️  Found ${allowlist.length} exception(s) in allowlist`);

  let allValid = true;
  const allErrors = [];

  for (let i = 0; i < allowlist.length; i++) {
    const entry = allowlist[i];
    const { valid, errors } = validateEntry(entry, i);

    if (!valid) {
      allValid = false;
      allErrors.push(...errors);
    }
  }

  if (!allValid) {
    console.error("\n❌ Allowlist validation failed:\n");
    for (const error of allErrors) {
      console.error(`   ${error}`);
    }
    console.error("\n❌ Fix the allowlist entries or remove invalid exceptions");
    console.error("\nAllowlist format:");
    console.error("  [");
    console.error("    {");
    console.error('      "file": "relative/path/to/file.ts",');
    console.error('      "rule": "category/ruleName",');
    console.error('      "justification": "Detailed explanation (min 10 chars)",');
    console.error('      "approver": "@username",');
    console.error('      "approvalDate": "2026-03-06",');
    console.error('      "expiryDate": "2026-06-01",');
    console.error('      "trackingIssue": "#123"');
    console.error("    }");
    console.error("  ]");
    console.error("\nSee docs/lint-strict-mode.md for policy.");
    process.exit(1);
  }

  console.log(`\n✅ All ${allowlist.length} exception(s) are valid`);
}

main();
