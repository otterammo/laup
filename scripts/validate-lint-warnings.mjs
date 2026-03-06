#!/usr/bin/env node

/**
 * Validate Lint Warnings Allowlist (CIG-002)
 *
 * This script validates that all lint warning exceptions are properly documented,
 * approved, and not expired. It's run in CI to enforce strict lint policies.
 *
 * Related: CIG-002 (Lint Strict Fail), Q-004 (Challenge Question on Lint Warnings)
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");

const ALLOWLIST_PATH = join(repoRoot, ".lint-warnings-allowlist.json");
const MAX_EXCEPTION_DAYS = 90;

// ANSI colors
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function error(msg) {
  console.error(`${RED}✗${RESET} ${msg}`);
}

function warn(msg) {
  console.warn(`${YELLOW}⚠${RESET} ${msg}`);
}

function success(msg) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}

function info(msg) {
  console.log(`  ${msg}`);
}

/**
 * Validate a single allowlist entry
 * @param {object} entry - Allowlist entry
 * @param {number} index - Entry index for error reporting
 * @returns {string[]} - Array of validation errors
 */
function validateEntry(entry, index) {
  const errors = [];
  const prefix = `Entry ${index + 1}`;

  // Required fields
  const requiredFields = [
    "file",
    "rule",
    "justification",
    "approver",
    "approvalDate",
    "expiryDate",
  ];

  for (const field of requiredFields) {
    if (!entry[field]) {
      errors.push(`${prefix}: Missing required field '${field}'`);
    }
  }

  // Validate file path format
  if (entry.file?.startsWith("/")) {
    errors.push(`${prefix}: 'file' must be relative path (got: ${entry.file})`);
  }

  // Validate rule format (should be category/ruleName)
  if (entry.rule && !entry.rule.includes("/")) {
    errors.push(`${prefix}: 'rule' should be in format 'category/ruleName' (got: ${entry.rule})`);
  }

  // Validate approver format (should start with @)
  if (entry.approver && !entry.approver.startsWith("@")) {
    errors.push(`${prefix}: 'approver' should start with @ (got: ${entry.approver})`);
  }

  // Validate date formats
  if (entry.approvalDate) {
    const approvalDate = new Date(entry.approvalDate);
    if (Number.isNaN(approvalDate.getTime())) {
      errors.push(
        `${prefix}: 'approvalDate' is not a valid ISO 8601 date (got: ${entry.approvalDate})`,
      );
    }
  }

  if (entry.expiryDate) {
    const expiryDate = new Date(entry.expiryDate);
    if (Number.isNaN(expiryDate.getTime())) {
      errors.push(
        `${prefix}: 'expiryDate' is not a valid ISO 8601 date (got: ${entry.expiryDate})`,
      );
    } else {
      // Check if expired
      const now = new Date();
      if (expiryDate < now) {
        errors.push(
          `${prefix}: Exception has EXPIRED (expiry: ${entry.expiryDate}, file: ${entry.file}, rule: ${entry.rule})`,
        );
      }

      // Check if expiry is too far in the future
      if (entry.approvalDate) {
        const approvalDate = new Date(entry.approvalDate);
        const daysDiff = (expiryDate - approvalDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > MAX_EXCEPTION_DAYS) {
          errors.push(
            `${prefix}: Exception period exceeds ${MAX_EXCEPTION_DAYS} days (got: ${Math.round(daysDiff)} days)`,
          );
        }
      }
    }
  }

  // Validate justification is meaningful
  if (entry.justification && entry.justification.length < 10) {
    errors.push(`${prefix}: 'justification' is too short (min 10 characters)`);
  }

  // Validate tracking issue format if present
  if (entry.trackingIssue && !entry.trackingIssue.match(/^#\d+$/)) {
    errors.push(
      `${prefix}: 'trackingIssue' should be in format '#123' (got: ${entry.trackingIssue})`,
    );
  }

  return errors;
}

/**
 * Main validation function
 */
function validateAllowlist() {
  info("Validating lint warnings allowlist...");

  let allowlist;
  try {
    const content = readFileSync(ALLOWLIST_PATH, "utf-8");
    allowlist = JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      error(`Allowlist file not found: ${ALLOWLIST_PATH}`);
      return false;
    }
    error(`Failed to parse allowlist JSON: ${err.message}`);
    return false;
  }

  if (!Array.isArray(allowlist)) {
    error("Allowlist must be a JSON array");
    return false;
  }

  if (allowlist.length === 0) {
    success("Allowlist is empty - no exceptions to validate");
    success("All lint warnings are treated as errors ✨");
    return true;
  }

  info(`Found ${allowlist.length} exception(s) to validate`);
  console.log();

  const allErrors = [];
  const warnings = [];

  for (let i = 0; i < allowlist.length; i++) {
    const entry = allowlist[i];
    const errors = validateEntry(entry, i);

    if (errors.length > 0) {
      allErrors.push(...errors);
    }

    // Warn if expiry is soon (within 7 days)
    if (entry.expiryDate) {
      const expiryDate = new Date(entry.expiryDate);
      const now = new Date();
      const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);

      if (daysUntilExpiry > 0 && daysUntilExpiry <= 7) {
        warnings.push(
          `Entry ${i + 1}: Exception expires soon (${Math.round(daysUntilExpiry)} days): ${entry.file} - ${entry.rule}`,
        );
      }
    }
  }

  // Report warnings
  if (warnings.length > 0) {
    console.log();
    for (const warning of warnings) {
      warn(warning);
    }
  }

  // Report errors
  if (allErrors.length > 0) {
    console.log();
    for (const err of allErrors) {
      error(err);
    }
    console.log();
    error(`Validation failed with ${allErrors.length} error(s)`);
    info("See docs/lint-strict-mode.md for exception policy");
    return false;
  }

  console.log();
  success(`All ${allowlist.length} exception(s) are valid`);
  info("Remember: exceptions should be temporary and time-bound");
  info("Target: zero exceptions at Phase 3 hard-gate rollout");

  return true;
}

// Run validation
const isValid = validateAllowlist();
process.exit(isValid ? 0 : 1);
