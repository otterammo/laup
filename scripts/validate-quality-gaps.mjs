#!/usr/bin/env node
/**
 * Validate quality/gaps.md ensures all open gaps have required fields.
 *
 * Requirements (QBASE-002):
 * - Every open gap must have: owner, target_date, status
 * - Severity must be: Critical, High, Medium, or Low
 * - Target dates must be valid ISO 8601 dates
 * - Closed gaps must reference the resolving PR
 *
 * Exit codes:
 * - 0: All validations passed
 * - 1: Validation errors found
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GAPS_FILE = path.join(REPO_ROOT, "quality", "gaps.md");

const VALID_SEVERITIES = new Set(["Critical", "High", "Medium", "Low"]);
const VALID_STATUSES = new Set(["Open", "In Progress", "Closed"]);

/**
 * Parse gaps.md and extract gap entries
 */
function parseGapsFile(content) {
  const gaps = [];
  const sections = content.split(/^## /m).filter(Boolean);

  let inOpenSection = false;
  let inClosedSection = false;

  for (const section of sections) {
    const lines = section.split("\n");
    const sectionTitle = lines[0]?.trim().toLowerCase() || "";

    if (sectionTitle.includes("open gaps")) {
      inOpenSection = true;
      inClosedSection = false;
    } else if (sectionTitle.includes("closed gaps")) {
      inOpenSection = false;
      inClosedSection = true;
    } else {
      inOpenSection = false;
      inClosedSection = false;
    }

    // Parse gap entries (marked by ### GAP-XXX:)
    const gapMatches = section.matchAll(/^### (GAP-\d+):\s*(.+?)$/gm);

    for (const match of gapMatches) {
      const gapId = match[1];
      const title = match[2];
      const startIndex = match.index || 0;

      // Extract the gap block until the next ### or end of section
      const blockEndMatch = section.slice(startIndex + match[0].length).match(/^###/m);
      const blockEnd = blockEndMatch
        ? startIndex + match[0].length + (blockEndMatch.index || 0)
        : section.length;
      const gapBlock = section.slice(startIndex, blockEnd);

      const gap = parseGapBlock(gapId, title, gapBlock, inOpenSection, inClosedSection);
      gaps.push(gap);
    }
  }

  return gaps;
}

/**
 * Parse a single gap block
 */
function parseGapBlock(gapId, title, block, isOpen, isClosed) {
  const gap = {
    id: gapId,
    title,
    isOpen,
    isClosed,
    severity: extractField(block, "Severity"),
    owner: extractField(block, "Owner"),
    targetDate: extractField(block, "Target Date"),
    status: extractField(block, "Status"),
    baselineMetric: extractField(block, "Baseline Metric"),
    resolvedBy: extractField(block, "Resolved By"),
  };

  return gap;
}

/**
 * Extract a field value from the gap block
 */
function extractField(block, fieldName) {
  const regex = new RegExp(`^\\*\\*${fieldName}:\\*\\*\\s*(.+?)$`, "m");
  const match = block.match(regex);
  return match?.[1]?.trim() || null;
}

/**
 * Validate a single gap entry
 */
function validateGap(gap) {
  const errors = [];

  // Required fields for all gaps
  if (!gap.severity) {
    errors.push(`${gap.id}: Missing required field 'Severity'`);
  } else if (!VALID_SEVERITIES.has(gap.severity)) {
    errors.push(
      `${gap.id}: Invalid severity '${gap.severity}'. Must be one of: ${Array.from(VALID_SEVERITIES).join(", ")}`,
    );
  }

  if (!gap.owner) {
    errors.push(`${gap.id}: Missing required field 'Owner'`);
  } else if (!gap.owner.startsWith("@")) {
    errors.push(`${gap.id}: Owner must be a GitHub username starting with @`);
  }

  if (!gap.targetDate) {
    errors.push(`${gap.id}: Missing required field 'Target Date'`);
  } else if (!isValidISODate(gap.targetDate)) {
    errors.push(
      `${gap.id}: Target Date '${gap.targetDate}' is not a valid ISO 8601 date (YYYY-MM-DD)`,
    );
  }

  if (!gap.status) {
    errors.push(`${gap.id}: Missing required field 'Status'`);
  } else if (!VALID_STATUSES.has(gap.status)) {
    errors.push(
      `${gap.id}: Invalid status '${gap.status}'. Must be one of: ${Array.from(VALID_STATUSES).join(", ")}`,
    );
  }

  if (!gap.baselineMetric) {
    errors.push(`${gap.id}: Missing required field 'Baseline Metric'`);
  }

  // Status-specific validations
  if (gap.status === "Closed" && !gap.resolvedBy) {
    errors.push(`${gap.id}: Closed gaps must include 'Resolved By' with PR reference`);
  }

  // Section consistency checks
  if (gap.isOpen && gap.status === "Closed") {
    errors.push(`${gap.id}: Gap is in 'Open Gaps' section but status is 'Closed'`);
  }

  if (gap.isClosed && gap.status !== "Closed") {
    errors.push(`${gap.id}: Gap is in 'Closed Gaps' section but status is not 'Closed'`);
  }

  return errors;
}

/**
 * Validate ISO 8601 date format (YYYY-MM-DD)
 */
function isValidISODate(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    return false;
  }

  const date = new Date(dateString);
  return date instanceof Date && !Number.isNaN(date.getTime());
}

/**
 * Main validation function
 */
function main() {
  console.log("🔍 Validating quality/gaps.md...\n");

  // Check if gaps file exists
  if (!fs.existsSync(GAPS_FILE)) {
    console.error(`❌ Error: ${GAPS_FILE} not found`);
    process.exit(1);
  }

  const content = fs.readFileSync(GAPS_FILE, "utf8");
  const gaps = parseGapsFile(content);

  console.log(`Found ${gaps.length} gap entries\n`);

  const openGaps = gaps.filter((g) => g.isOpen);
  const closedGaps = gaps.filter((g) => g.isClosed);

  console.log(`  Open: ${openGaps.length}`);
  console.log(`  Closed: ${closedGaps.length}\n`);

  // Validate all gaps
  const allErrors = [];

  for (const gap of gaps) {
    const errors = validateGap(gap);
    allErrors.push(...errors);
  }

  // Report results
  if (allErrors.length === 0) {
    console.log("✅ All quality gaps are properly tracked\n");
    console.log("Summary:");
    console.log(`  - All ${gaps.length} gaps have required fields`);
    console.log("  - All severities are valid");
    console.log("  - All target dates are valid ISO 8601 dates");
    console.log("  - All closed gaps reference resolution PRs");
    process.exit(0);
  }

  console.error("❌ Validation errors found:\n");
  for (const error of allErrors) {
    console.error(`  - ${error}`);
  }
  console.error(`\nTotal errors: ${allErrors.length}`);
  process.exit(1);
}

main();
