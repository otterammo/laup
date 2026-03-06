#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * LGR-007: Reproducible Toolchain Contract
 *
 * Verifies that Node.js and pnpm versions meet the requirements
 * defined in package.json (the authoritative source).
 *
 * - Reads version constraints from package.json "engines" and "packageManager"
 * - Checks actual versions of Node and pnpm
 * - Exits with code 1 if versions don't meet requirements
 * - Displays clear error messages with required vs detected values
 */

function readPackageJson() {
  try {
    const content = readFileSync("package.json", "utf8");
    return JSON.parse(content);
  } catch (error) {
    console.error("✖ Failed to read package.json");
    console.error(error.message);
    process.exit(1);
  }
}

function getNodeVersion() {
  return process.version; // e.g., "v22.0.0"
}

function getPnpmVersion() {
  try {
    const version = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
    return version; // e.g., "9.15.4"
  } catch (_error) {
    console.error("✖ Failed to detect pnpm version");
    console.error("  Ensure pnpm is installed and available in PATH");
    process.exit(1);
  }
}

/**
 * Parse semver range like ">=22.0.0" or "^9.0.0"
 * Returns { operator, version } or null if invalid
 */
function parseVersionConstraint(constraint) {
  const match = constraint.match(/^([><=^~]*)(.+)$/);
  if (!match) return null;

  return {
    operator: match[1] || "=",
    version: match[2],
  };
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
function compareSemver(a, b) {
  const aParts = a.replace(/^v/, "").split(".").map(Number);
  const bParts = b.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;

    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }

  return 0;
}

/**
 * Check if version satisfies constraint
 */
function satisfiesConstraint(version, constraint) {
  const parsed = parseVersionConstraint(constraint);
  if (!parsed) {
    console.log(`⚠ Warning: Could not parse version constraint "${constraint}"`);
    return true; // Skip validation for unparseable constraints
  }

  const { operator, version: requiredVersion } = parsed;
  const cmp = compareSemver(version, requiredVersion);

  switch (operator) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
    case "":
      return cmp === 0;
    case "^": {
      // ^X.Y.Z means >=X.Y.Z and <(X+1).0.0
      if (cmp < 0) return false;
      const versionParts = version.replace(/^v/, "").split(".");
      const requiredParts = requiredVersion.split(".");
      return Number(versionParts[0]) === Number(requiredParts[0]);
    }
    case "~": {
      // ~X.Y.Z means >=X.Y.Z and <X.(Y+1).0
      if (cmp < 0) return false;
      const vParts = version.replace(/^v/, "").split(".");
      const rParts = requiredVersion.split(".");
      return Number(vParts[0]) === Number(rParts[0]) && Number(vParts[1]) === Number(rParts[1]);
    }
    default:
      console.log(`⚠ Warning: Unknown operator "${operator}" in constraint "${constraint}"`);
      return true;
  }
}

/**
 * Extract exact version from packageManager field
 * e.g., "pnpm@9.15.4" -> "9.15.4"
 */
function extractPackageManagerVersion(packageManager) {
  if (!packageManager) return null;

  const match = packageManager.match(/^pnpm@(.+)$/);
  return match ? match[1] : null;
}

function main() {
  const pkg = readPackageJson();
  const engines = pkg.engines || {};
  const packageManager = pkg.packageManager;

  console.log("== Toolchain Version Check (LGR-007) ==\n");

  let hasErrors = false;

  // Check Node.js version
  const nodeConstraint = engines.node;
  const nodeVersion = getNodeVersion();

  if (!nodeConstraint) {
    console.log('⚠ Warning: No "engines.node" constraint defined in package.json');
  } else {
    console.log(`Node.js:`);
    console.log(`  Required: ${nodeConstraint}`);
    console.log(`  Detected: ${nodeVersion}`);

    if (!satisfiesConstraint(nodeVersion, nodeConstraint)) {
      console.error(`  ✖ Version mismatch!\n`);
      hasErrors = true;
    } else {
      console.log(`  ✓ OK\n`);
    }
  }

  // Check pnpm version
  const pnpmConstraint = engines.pnpm;
  const pnpmExact = extractPackageManagerVersion(packageManager);
  const pnpmVersion = getPnpmVersion();

  if (!pnpmConstraint && !pnpmExact) {
    console.log('⚠ Warning: No "engines.pnpm" or "packageManager" constraint defined');
  } else {
    console.log(`pnpm:`);

    if (pnpmConstraint) {
      console.log(`  Required: ${pnpmConstraint}`);
    }
    if (pnpmExact) {
      console.log(`  Exact (packageManager): ${pnpmExact}`);
    }

    console.log(`  Detected: ${pnpmVersion}`);

    // Check against engines.pnpm constraint
    if (pnpmConstraint && !satisfiesConstraint(pnpmVersion, pnpmConstraint)) {
      console.error(`  ✖ Does not satisfy engines.pnpm constraint!\n`);
      hasErrors = true;
    } else if (pnpmConstraint) {
      console.log(`  ✓ Satisfies engines.pnpm\n`);
    }

    // Warn if not exact match with packageManager
    if (pnpmExact && pnpmVersion !== pnpmExact) {
      console.log(
        `  ⚠ Warning: Detected version (${pnpmVersion}) differs from packageManager (${pnpmExact})`,
      );
      console.log(`  Consider running: corepack install\n`);
    }
  }

  if (hasErrors) {
    console.error("✖ Toolchain version requirements not met.");
    console.error("  Please update your Node.js and/or pnpm installation.\n");
    process.exit(1);
  }

  console.log("✓ All toolchain version requirements satisfied.\n");
}

main();
