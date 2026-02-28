import { readFileSync } from "node:fs";
import matter from "gray-matter";
import type { CanonicalInstruction } from "./schema.js";
import { CanonicalInstructionSchema, FrontmatterSchema } from "./schema.js";

export interface FieldIssue {
  path: string;
  message: string;
}

export class ParseError extends Error {
  /** Per-field issues when the failure is a schema validation error (not a YAML parse error). */
  readonly fieldIssues: FieldIssue[];

  constructor(message: string, cause?: unknown, fieldIssues: FieldIssue[] = []) {
    super(message, { cause });
    this.name = "ParseError";
    this.fieldIssues = fieldIssues;
  }
}

/**
 * Parse a canonical instruction file from its string content.
 * Supports both Form 1 (frontmatter + body) and Form 2 (body only).
 * ADR-001 §7.1, §7.5
 */
export function parseCanonicalString(content: string): CanonicalInstruction {
  let rawFrontmatter: Record<string, unknown> = {};
  let body: string;

  try {
    // gray-matter uses js-yaml with safe loading by default — acceptable per ADR-001 §7.5
    const parsed = matter(content);
    rawFrontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content.trim();
  } catch (err) {
    throw new ParseError(`Failed to parse YAML frontmatter: ${String(err)}`, err);
  }

  const frontmatterResult = FrontmatterSchema.safeParse(rawFrontmatter);
  if (!frontmatterResult.success) {
    const fieldIssues: FieldIssue[] = frontmatterResult.error.issues.map((issue) => ({
      path: issue.path.join(".") || "frontmatter",
      message: issue.message,
    }));
    const messages = fieldIssues.map((fi) => `  ${fi.path}: ${fi.message}`).join("\n");
    throw new ParseError(
      `Frontmatter schema validation failed:\n${messages}`,
      undefined,
      fieldIssues,
    );
  }

  return CanonicalInstructionSchema.parse({
    frontmatter: frontmatterResult.data,
    body,
  });
}

/**
 * Parse a canonical instruction file from disk.
 * ADR-001 §7.1, §7.5
 */
export function parseCanonical(filePath: string): CanonicalInstruction {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new ParseError(`Cannot read file '${filePath}': ${String(err)}`, err);
  }
  return parseCanonicalString(content);
}
