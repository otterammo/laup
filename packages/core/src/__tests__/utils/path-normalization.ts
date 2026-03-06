/**
 * Path normalization utilities for cross-platform test hermeticity
 *
 * Requirements: CIG-004 (DOC-620)
 *
 * Handles platform-specific path differences:
 * - macOS /private symlink behavior (/tmp → /private/tmp)
 * - Windows drive letter casing
 * - Path separator normalization
 */

import { realpathSync } from "node:fs";
import { normalize, sep } from "node:path";

/**
 * Normalize a path for cross-platform comparison
 *
 * On macOS, resolves symlinks like /tmp → /private/tmp
 * On Windows, normalizes drive letters to uppercase
 * On all platforms, normalizes separators and converts to absolute paths
 *
 * @param inputPath - Path to normalize
 * @returns Normalized absolute path
 */
export function normalizePath(inputPath: string): string {
  const { resolve } = require("node:path");

  try {
    // Resolve to absolute path and resolve symlinks (handles macOS /private)
    const realPath = realpathSync(resolve(inputPath));

    // Normalize separators and remove trailing slashes
    const normalized = normalize(realPath);

    // On Windows, normalize drive letter to uppercase
    if (process.platform === "win32" && /^[a-z]:/.test(normalized)) {
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    return normalized;
  } catch {
    // If path doesn't exist, resolve and normalize the input
    const normalized = normalize(resolve(inputPath));

    if (process.platform === "win32" && /^[a-z]:/.test(normalized)) {
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    return normalized;
  }
}

/**
 * Compare two paths for equality across platforms
 *
 * @param pathA - First path
 * @param pathB - Second path
 * @returns True if paths refer to the same location
 */
export function pathsEqual(pathA: string, pathB: string): boolean {
  return normalizePath(pathA) === normalizePath(pathB);
}

/**
 * Get the platform-specific path separator
 *
 * @returns Path separator for current platform
 */
export function getPathSeparator(): string {
  return sep;
}

/**
 * Convert a path to use forward slashes (for snapshots/comparisons)
 *
 * @param inputPath - Path to convert
 * @returns Path with forward slashes
 */
export function toForwardSlashes(inputPath: string): string {
  // Replace all backslashes with forward slashes
  return inputPath.replace(/\\/g, "/");
}
