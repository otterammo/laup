import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseCanonicalString } from "./parse.js";
import type { CanonicalInstruction } from "./schema.js";
import type { ScopedDocument } from "./scope.js";
import { mergeScopes } from "./scope.js";

/**
 * Options for loading hierarchical instructions.
 */
export interface HierarchyOptions {
  /** Filename to search for in parent directories. Default: "laup.md" */
  filename?: string | undefined;
  /** Stop searching at this directory (exclusive). Default: filesystem root */
  stopAt?: string | undefined;
  /** Maximum depth to traverse. Default: 10 */
  maxDepth?: number | undefined;
}

/**
 * Result of loading hierarchical instructions.
 */
export interface HierarchyLoadResult {
  /** Documents found, ordered from root (lowest precedence) to target (highest). */
  documents: ScopedDocument[];
  /** The merged result of all documents. */
  merged: CanonicalInstruction;
  /** Directories searched that didn't contain the instruction file. */
  searched: string[];
}

/**
 * Load instructions from a file and all parent directories containing the same filename.
 *
 * Traverses from the target file's directory up to the filesystem root (or stopAt),
 * collecting all instruction files found. Merges them with parent directories
 * having lower precedence than child directories.
 *
 * This implements Claude Code's parent-directory loading behavior (CONF-005).
 *
 * @param targetPath - Path to the target instruction file.
 * @param options - Configuration options.
 * @returns Load result with all documents and merged result.
 * @throws Error if target file doesn't exist or circular reference detected.
 */
export function loadHierarchy(
  targetPath: string,
  options: HierarchyOptions = {},
): HierarchyLoadResult {
  const filename = options.filename ?? "laup.md";
  const maxDepth = options.maxDepth ?? 10;
  const resolvedTarget = resolve(targetPath);
  const stopAt = options.stopAt ? resolve(options.stopAt) : undefined;

  if (!existsSync(resolvedTarget)) {
    throw new Error(`Target file not found: ${resolvedTarget}`);
  }

  // Get real path to detect symlink cycles
  const realTarget = realpathSync(resolvedTarget);
  const targetDir = dirname(realTarget);

  // Collect all directories from target up to root/stopAt
  const directories: string[] = [];
  const seen = new Set<string>();
  let current = targetDir;
  let depth = 0;

  while (depth < maxDepth) {
    // Get real path to detect symlink cycles
    let realCurrent: string;
    try {
      realCurrent = realpathSync(current);
    } catch {
      // Directory doesn't exist or can't be resolved
      break;
    }

    // Check for circular reference (symlink cycle)
    if (seen.has(realCurrent)) {
      throw new Error(`Circular reference detected at: ${current}`);
    }
    seen.add(realCurrent);

    directories.push(realCurrent);

    // Check if we've reached the stop point
    if (stopAt && (realCurrent === stopAt || realCurrent.startsWith(`${stopAt}/`))) {
      // Include stopAt directory but don't go above it
      if (realCurrent !== stopAt) {
        const parent = dirname(realCurrent);
        if (parent === stopAt) {
          directories.push(parent);
        }
      }
      break;
    }

    // Check if we've reached the filesystem root
    const parent = dirname(realCurrent);
    if (parent === realCurrent) {
      break;
    }

    current = parent;
    depth++;
  }

  // Reverse so root is first (lowest precedence)
  directories.reverse();

  // Load documents from each directory that has the file
  const documents: ScopedDocument[] = [];
  const searched: string[] = [];

  for (const dir of directories) {
    const filePath = join(dir, filename);

    if (existsSync(filePath)) {
      // Special case: target file - use the original path
      const isTarget = realpathSync(filePath) === realTarget;
      const actualPath = isTarget ? resolvedTarget : filePath;

      const content = readFileSync(actualPath, "utf-8");
      const document = parseCanonicalString(content);

      documents.push({
        scope: "project", // All hierarchy docs are project scope
        path: actualPath,
        document,
      });
    } else {
      searched.push(dir);
    }
  }

  if (documents.length === 0) {
    throw new Error(`No instruction files found in hierarchy for: ${resolvedTarget}`);
  }

  // Merge all documents (first = lowest precedence, last = highest)
  const merged = mergeScopes(documents);

  return { documents, merged, searched };
}

/**
 * Find the root instruction file by walking up from a starting directory.
 *
 * @param startDir - Directory to start searching from.
 * @param filename - Filename to search for. Default: "laup.md"
 * @returns Path to the root instruction file, or undefined if not found.
 */
export function findRootInstruction(startDir: string, filename = "laup.md"): string | undefined {
  let current = resolve(startDir);
  let rootPath: string | undefined;

  const seen = new Set<string>();

  while (true) {
    const realCurrent = realpathSync(current);
    if (seen.has(realCurrent)) break;
    seen.add(realCurrent);

    const filePath = join(realCurrent, filename);
    if (existsSync(filePath)) {
      rootPath = filePath;
    }

    const parent = dirname(realCurrent);
    if (parent === realCurrent) break;
    current = parent;
  }

  return rootPath;
}
