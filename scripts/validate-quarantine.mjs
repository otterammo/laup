#!/usr/bin/env node

/**
 * CIG-008: Quarantine Manifest Validator
 *
 * Validates that all quarantined tests have proper metadata and are not overdue.
 *
 * Usage:
 *   node scripts/validate-quarantine.mjs
 *
 * Exit codes:
 *   0 - No violations found
 *   1 - Violations found (missing manifest, overdue tests, invalid metadata)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const QUARANTINE_MANIFEST = ".quarantine-manifest.json";
const MAX_QUARANTINE_DAYS = 14;

/**
 * Recursively find all quarantine directories and their test files
 * @param {string} dir
 * @param {Array} results
 * @returns {Array<{dir: string, files: string[], manifestPath: string}>}
 */
function findQuarantineDirectories(dir, results = []) {
  const files = readdirSync(dir);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules, .git, coverage, and dist directories
      if (file === "node_modules" || file === ".git" || file === "coverage" || file === "dist") {
        continue;
      }

      // Check if this is a quarantine directory
      if (file === "quarantine" && dir.includes("__tests__")) {
        const manifestPath = join(filePath, QUARANTINE_MANIFEST);
        const testFiles = readdirSync(filePath).filter(
          (f) =>
            f.endsWith(".test.ts") ||
            f.endsWith(".test.js") ||
            f.endsWith(".spec.ts") ||
            f.endsWith(".spec.js"),
        );

        results.push({
          dir: filePath,
          files: testFiles,
          manifestPath,
        });
      }

      findQuarantineDirectories(filePath, results);
    }
  }

  return results;
}

/**
 * Load and parse quarantine manifest
 * @param {string} manifestPath
 * @returns {{version: string, tests: Array} | null}
 */
function loadManifest(manifestPath) {
  try {
    if (!existsSync(manifestPath)) {
      return null;
    }
    const content = readFileSync(manifestPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`ERROR: Failed to parse manifest at ${manifestPath}: ${error.message}`);
    return null;
  }
}

/**
 * Validate a quarantine entry
 * @param {object} entry
 * @param {string} quarantineDir
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function validateEntry(entry, quarantineDir) {
  const errors = [];
  const warnings = [];

  // Check required fields
  if (!entry.path) {
    errors.push("Missing required field: path");
  }
  if (!entry.issueId) {
    errors.push("Missing required field: issueId");
  }
  if (!entry.owner) {
    errors.push("Missing required field: owner");
  }
  if (!entry.quarantinedAt) {
    errors.push("Missing required field: quarantinedAt");
  }
  if (!entry.targetFixDate) {
    errors.push("Missing required field: targetFixDate");
  }
  if (!entry.reason) {
    errors.push("Missing required field: reason");
  }

  // Validate dates
  if (entry.quarantinedAt) {
    const quarantinedDate = new Date(entry.quarantinedAt);
    if (Number.isNaN(quarantinedDate.getTime())) {
      errors.push(`Invalid quarantinedAt date format: ${entry.quarantinedAt}`);
    }
  }

  if (entry.targetFixDate) {
    const targetDate = new Date(entry.targetFixDate);
    const now = new Date();

    if (Number.isNaN(targetDate.getTime())) {
      errors.push(`Invalid targetFixDate format: ${entry.targetFixDate}`);
    } else {
      // Check if overdue
      if (targetDate < now) {
        errors.push(`Test is OVERDUE (target fix date: ${entry.targetFixDate})`);
      }

      // Warn if approaching deadline (< 3 days)
      const daysUntilDeadline = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
      if (daysUntilDeadline <= 3 && daysUntilDeadline > 0) {
        warnings.push(`Approaching deadline: ${daysUntilDeadline} days remaining`);
      }

      // Check if quarantine period is too long
      if (entry.quarantinedAt) {
        const quarantinedDate = new Date(entry.quarantinedAt);
        const quarantineDays = Math.ceil((targetDate - quarantinedDate) / (1000 * 60 * 60 * 24));
        if (quarantineDays > MAX_QUARANTINE_DAYS) {
          warnings.push(
            `Quarantine period exceeds ${MAX_QUARANTINE_DAYS} days (${quarantineDays} days)`,
          );
        }
      }
    }
  }

  // Check if test file exists
  if (entry.path) {
    const testFilePath = join(quarantineDir, entry.path);
    if (!existsSync(testFilePath)) {
      errors.push(`Test file not found: ${relative(process.cwd(), testFilePath)}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Main validation function
 */
function main() {
  console.log("CIG-008: Validating quarantine manifests across all packages...\n");

  // Find all quarantine directories
  const quarantineDirs = findQuarantineDirectories(process.cwd());

  if (quarantineDirs.length === 0) {
    console.log("✅ No quarantine directories found");
    return;
  }

  console.log(`Found ${quarantineDirs.length} quarantine directories\n`);

  let hasViolations = false;
  let totalQuarantined = 0;
  let totalOverdue = 0;

  for (const { dir, files, manifestPath } of quarantineDirs) {
    const relativeDir = relative(process.cwd(), dir);

    // Check if manifest exists
    const manifest = loadManifest(manifestPath);

    if (!manifest) {
      if (files.length > 0) {
        hasViolations = true;
        console.error(`❌ ${relativeDir}: Missing manifest file`);
        console.error(`   Found ${files.length} test file(s) without metadata:`);
        for (const file of files) {
          console.error(`   - ${file}`);
        }
        console.error(`\n   Create ${QUARANTINE_MANIFEST} with required metadata.`);
      }
      continue;
    }

    // Validate manifest version
    if (manifest.version !== "1.0") {
      hasViolations = true;
      console.error(`❌ ${relativeDir}: Invalid manifest version: ${manifest.version}`);
      continue;
    }

    // Check for orphaned test files (in quarantine but not in manifest)
    const manifestPaths = manifest.tests.map((t) => t.path);
    const orphanedFiles = files.filter((f) => !manifestPaths.includes(f));

    if (orphanedFiles.length > 0) {
      hasViolations = true;
      console.error(`❌ ${relativeDir}: Orphaned test files (not in manifest):`);
      for (const file of orphanedFiles) {
        console.error(`   - ${file}`);
      }
    }

    // Validate each entry
    for (const entry of manifest.tests) {
      totalQuarantined++;

      const validation = validateEntry(entry, dir);

      if (!validation.valid) {
        hasViolations = true;
        console.error(`\n❌ ${relativeDir}/${entry.path}: Manifest validation failed`);
        console.error(`   Issue: ${entry.issueId || "N/A"}`);
        console.error(`   Owner: ${entry.owner || "N/A"}`);

        for (const error of validation.errors) {
          console.error(`   - ${error}`);
          if (error.includes("OVERDUE")) {
            totalOverdue++;
          }
        }
      } else if (validation.warnings.length > 0) {
        console.warn(`⚠️  ${relativeDir}/${entry.path}: Warnings (Issue: ${entry.issueId})`);
        for (const warning of validation.warnings) {
          console.warn(`   - ${warning}`);
        }
      } else {
        console.log(
          `✅ ${relativeDir}/${entry.path}: Valid (Issue: ${entry.issueId}, Owner: ${entry.owner})`,
        );
      }
    }
  }

  console.log(
    `\n📊 Summary: ${totalQuarantined} quarantined tests across ${quarantineDirs.length} directories`,
  );

  if (totalOverdue > 0) {
    console.error(`⚠️  ${totalOverdue} tests are OVERDUE for remediation`);
  }

  if (hasViolations) {
    console.error("\n❌ CIG-008: Quarantine validation FAILED");
    process.exit(1);
  }

  console.log("✅ CIG-008: All quarantine manifests valid");
}

main();
