import { ZodError } from "zod";
import { ParseError, parseCanonicalString } from "./parse.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const KNOWN_TOOL_IDS = new Set([
  "claude-code",
  "copilot",
  "gemini",
  "opencode",
  "cursor",
  "windsurf",
  "aider",
  "continue",
  "devin",
]);

/**
 * Validate a canonical instruction file's string content.
 * Returns a structured result rather than throwing — callers can inspect
 * individual issues. ADR-001 §7.6
 */
export function validateCanonical(content: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  // ── Structural + schema validation ──────────────────────────────────────
  let doc: ReturnType<typeof parseCanonicalString> | null = null;
  try {
    doc = parseCanonicalString(content);
  } catch (err) {
    if (err instanceof ParseError) {
      if (err.fieldIssues.length > 0) {
        // Schema validation failure — use per-field issues for precise diagnostics
        issues.push(...err.fieldIssues);
      } else {
        // YAML parse failure or file I/O error — no field-level info available
        issues.push({ path: "document", message: err.message });
      }
    } else if (err instanceof ZodError) {
      for (const issue of err.issues) {
        issues.push({ path: issue.path.join(".") || "document", message: issue.message });
      }
    } else {
      issues.push({ path: "document", message: String(err) });
    }
    return { valid: false, issues };
  }

  // ── Body check ───────────────────────────────────────────────────────────
  if (!doc.body || doc.body.trim().length === 0) {
    issues.push({
      path: "body",
      message: "Instruction body is empty. At minimum, provide a brief description.",
    });
  }

  // ── Unknown tool identifier warnings (ADR-001 §7.6, step 5) ─────────────
  if (doc.frontmatter.tools) {
    for (const toolId of Object.keys(doc.frontmatter.tools)) {
      if (!KNOWN_TOOL_IDS.has(toolId)) {
        issues.push({
          path: `tools.${toolId}`,
          message: `Unknown tool identifier '${toolId}'. Known tools: ${[...KNOWN_TOOL_IDS].join(", ")}. Unrecognized tools are ignored by the sync engine.`,
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
