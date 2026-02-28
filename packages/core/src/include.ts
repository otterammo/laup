import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Options for processing includes.
 */
export interface IncludeOptions {
  /** Maximum include depth to prevent runaway recursion. Default: 10 */
  maxDepth?: number | undefined;
  /** Base directory for resolving relative paths. Default: source file's directory */
  baseDir?: string | undefined;
}

/**
 * Result of processing includes.
 */
export interface IncludeResult {
  /** The expanded content with includes resolved. */
  content: string;
  /** All files that were included (for dependency tracking). */
  includedFiles: string[];
  /** Any warnings encountered during processing. */
  warnings: string[];
}

/** Pattern to match @include directives. Supports @include path or @include "path" */
const INCLUDE_PATTERN = /^@include\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/gm;

/**
 * Process @include directives in content, recursively expanding included files.
 *
 * Supports the following syntax:
 * - `@include ./relative/path.md`
 * - `@include /absolute/path.md`
 * - `@include "path with spaces.md"`
 * - `@include 'path with spaces.md'`
 *
 * Include directives must be on their own line. The entire line is replaced
 * with the contents of the included file.
 *
 * @param content - The content to process.
 * @param sourcePath - Path to the source file (for resolving relative includes).
 * @param options - Processing options.
 * @returns The expanded content with all includes resolved.
 * @throws Error if circular include detected or max depth exceeded.
 */
export function processIncludes(
  content: string,
  sourcePath: string,
  options: IncludeOptions = {},
): IncludeResult {
  const maxDepth = options.maxDepth ?? 10;
  const baseDir = options.baseDir ?? dirname(resolve(sourcePath));

  const includedFiles: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  // Add source file to seen set to detect circular includes
  const realSourcePath = realpathSync(resolve(sourcePath));
  seen.add(realSourcePath);

  const expanded = expandIncludes(content, baseDir, {
    maxDepth,
    currentDepth: 0,
    seen,
    includedFiles,
    warnings,
  });

  return { content: expanded, includedFiles, warnings };
}

interface ExpandContext {
  maxDepth: number;
  currentDepth: number;
  seen: Set<string>;
  includedFiles: string[];
  warnings: string[];
}

function expandIncludes(content: string, baseDir: string, ctx: ExpandContext): string {
  if (ctx.currentDepth >= ctx.maxDepth) {
    throw new Error(`Maximum include depth (${ctx.maxDepth}) exceeded`);
  }

  // Process each @include directive
  return content.replace(INCLUDE_PATTERN, (_match, quoted1, quoted2, unquoted) => {
    const includePath = quoted1 ?? quoted2 ?? unquoted;

    // Resolve the include path
    const resolvedPath = isAbsolute(includePath)
      ? resolve(includePath)
      : resolve(baseDir, includePath);

    // Check if file exists
    if (!existsSync(resolvedPath)) {
      ctx.warnings.push(`Include file not found: ${includePath} (resolved to ${resolvedPath})`);
      return `<!-- Include not found: ${includePath} -->`;
    }

    // Get real path to detect circular includes via symlinks
    let realPath: string;
    try {
      realPath = realpathSync(resolvedPath);
    } catch {
      ctx.warnings.push(`Cannot resolve include path: ${includePath}`);
      return `<!-- Cannot resolve: ${includePath} -->`;
    }

    // Check for circular include
    if (ctx.seen.has(realPath)) {
      throw new Error(`Circular include detected: ${includePath} (${realPath})`);
    }

    // Mark as seen
    ctx.seen.add(realPath);
    ctx.includedFiles.push(realPath);

    // Read and recursively process the included file
    const includedContent = readFileSync(resolvedPath, "utf-8");
    const includeDir = dirname(resolvedPath);

    // Recursively expand includes in the included content
    const expanded = expandIncludes(includedContent, includeDir, {
      ...ctx,
      currentDepth: ctx.currentDepth + 1,
    });

    return expanded;
  });
}

/**
 * Check if content contains any @include directives.
 */
export function hasIncludes(content: string): boolean {
  INCLUDE_PATTERN.lastIndex = 0;
  return INCLUDE_PATTERN.test(content);
}

/**
 * Extract all include paths from content without resolving them.
 */
export function extractIncludePaths(content: string): string[] {
  const paths: string[] = [];

  INCLUDE_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(INCLUDE_PATTERN)) {
    const path = match[1] ?? match[2] ?? match[3];
    if (path) {
      paths.push(path);
    }
  }

  return paths;
}
