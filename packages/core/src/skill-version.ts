/**
 * Semantic versioning utilities for skills (SKILL-003).
 */

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * Parse a semver string into components.
 */
export function parseVersion(version: string): SemanticVersion | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z0-9.]+))?$/i);
  if (!match) return null;

  const result: SemanticVersion = {
    major: Number.parseInt(match[1] ?? "0", 10),
    minor: Number.parseInt(match[2] ?? "0", 10),
    patch: Number.parseInt(match[3] ?? "0", 10),
  };

  if (match[4]) {
    result.prerelease = match[4];
  }

  return result;
}

/**
 * Compare two versions. Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (!va || !vb) {
    throw new Error(`Invalid version: ${!va ? a : b}`);
  }

  // Compare major.minor.patch
  if (va.major !== vb.major) return va.major - vb.major;
  if (va.minor !== vb.minor) return va.minor - vb.minor;
  if (va.patch !== vb.patch) return va.patch - vb.patch;

  // Prerelease versions have lower precedence
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  if (va.prerelease && vb.prerelease) {
    return va.prerelease.localeCompare(vb.prerelease);
  }

  return 0;
}

/**
 * Version constraint types.
 */
export type VersionConstraint =
  | { type: "exact"; version: string }
  | { type: "range"; min?: string; max?: string; minInclusive?: boolean; maxInclusive?: boolean }
  | { type: "caret"; version: string } // ^1.2.3 - compatible with 1.x.x
  | { type: "tilde"; version: string } // ~1.2.3 - compatible with 1.2.x
  | { type: "any" };

/**
 * Parse a version constraint string.
 * Supports: exact (1.0.0), caret (^1.0.0), tilde (~1.0.0), range (>=1.0.0 <2.0.0), any (*)
 */
export function parseConstraint(constraint: string): VersionConstraint {
  const trimmed = constraint.trim();

  if (trimmed === "*" || trimmed === "latest") {
    return { type: "any" };
  }

  if (trimmed.startsWith("^")) {
    return { type: "caret", version: trimmed.slice(1) };
  }

  if (trimmed.startsWith("~")) {
    return { type: "tilde", version: trimmed.slice(1) };
  }

  // Range: >=1.0.0 <2.0.0
  const rangeMatch = trimmed.match(
    /^(>=?)?(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)\s+(<?=?)(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)$/i,
  );
  if (rangeMatch?.[2] && rangeMatch[4]) {
    return {
      type: "range",
      min: rangeMatch[2],
      max: rangeMatch[4],
      minInclusive: rangeMatch[1] === ">=" || !rangeMatch[1],
      maxInclusive: rangeMatch[3] === "<=",
    };
  }

  // Single bound: >=1.0.0 or <2.0.0
  const singleBoundMatch = trimmed.match(/^(>=?|<=?)?(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)$/i);
  if (singleBoundMatch?.[2]) {
    const op = singleBoundMatch[1];
    const ver = singleBoundMatch[2];

    if (!op) {
      return { type: "exact", version: ver };
    }

    if (op === ">=" || op === ">") {
      return { type: "range", min: ver, minInclusive: op === ">=" };
    }
    if (op === "<=" || op === "<") {
      return { type: "range", max: ver, maxInclusive: op === "<=" };
    }
  }

  // Default to exact match
  return { type: "exact", version: trimmed };
}

/**
 * Check if a version satisfies a constraint.
 */
export function satisfiesConstraint(version: string, constraint: VersionConstraint): boolean {
  const v = parseVersion(version);
  if (!v) return false;

  switch (constraint.type) {
    case "any":
      return true;

    case "exact":
      return compareVersions(version, constraint.version) === 0;

    case "caret": {
      // ^1.2.3 means >=1.2.3 <2.0.0 (or <1.0.0 if major is 0)
      const base = parseVersion(constraint.version);
      if (!base) return false;

      const cmp = compareVersions(version, constraint.version);
      if (cmp < 0) return false;

      if (base.major === 0) {
        // ^0.x.y is more restrictive
        return v.major === 0 && v.minor === base.minor;
      }
      return v.major === base.major;
    }

    case "tilde": {
      // ~1.2.3 means >=1.2.3 <1.3.0
      const base = parseVersion(constraint.version);
      if (!base) return false;

      const cmp = compareVersions(version, constraint.version);
      if (cmp < 0) return false;

      return v.major === base.major && v.minor === base.minor;
    }

    case "range": {
      if (constraint.min) {
        const minCmp = compareVersions(version, constraint.min);
        if (constraint.minInclusive ? minCmp < 0 : minCmp <= 0) {
          return false;
        }
      }
      if (constraint.max) {
        const maxCmp = compareVersions(version, constraint.max);
        if (constraint.maxInclusive ? maxCmp > 0 : maxCmp >= 0) {
          return false;
        }
      }
      return true;
    }
  }
}

/**
 * Check if a version string satisfies a constraint string.
 */
export function satisfies(version: string, constraint: string): boolean {
  return satisfiesConstraint(version, parseConstraint(constraint));
}

/**
 * Find the latest version that satisfies a constraint.
 */
export function findLatestSatisfying(versions: string[], constraint: string): string | null {
  const parsed = parseConstraint(constraint);
  const satisfying = versions.filter((v) => satisfiesConstraint(v, parsed));

  if (satisfying.length === 0) return null;

  const sorted = satisfying.sort(compareVersions).reverse();
  return sorted[0] ?? null;
}

/**
 * Sort versions in descending order (latest first).
 */
export function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort(compareVersions).reverse();
}
