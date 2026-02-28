import { z } from "zod";

// ─── Per-tool override schemas (ADR-001 §7.3) ────────────────────────────────

// Zod v4: z.looseObject() preserves unknown keys (replaces z.object().passthrough())
// Per-tool schemas use z.object() — strips unknown keys, which is correct for typed overrides

const ClaudeCodeOverrideSchema = z.object({
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
});

const CursorOverrideSchema = z.object({
  globs: z.array(z.string()).optional(),
  alwaysApply: z.boolean().optional(),
  description: z.string().optional(),
});

const AiderOverrideSchema = z.object({
  model: z.string().optional(),
  editorModel: z.string().optional(),
  autoCommits: z.boolean().optional(),
  read: z.array(z.string()).optional(),
});

const GeminiOverrideSchema = z.object({
  model: z.string().optional(),
  sandbox: z.boolean().optional(),
});

const OpenCodeOverrideSchema = z.object({
  model: z.string().optional(),
  provider: z.string().optional(),
});

const WindsurfOverrideSchema = z.object({
  alwaysApply: z.boolean().optional(),
});

const ContinueOverrideSchema = z.object({
  defaultModel: z.string().optional(),
  contextProviders: z.array(z.unknown()).optional(),
});

const DevinOverrideSchema = z.object({
  playbook: z.string().optional(),
});

const CopilotOverrideSchema = z.object({});

// looseObject preserves unknown tool IDs at runtime so validate.ts can
// detect and report them (ADR-001 §7.6, step 5 — unknown ID is a warning, not error)
export const ToolOverridesSchema = z.looseObject({
  "claude-code": ClaudeCodeOverrideSchema.optional(),
  copilot: CopilotOverrideSchema.optional(),
  gemini: GeminiOverrideSchema.optional(),
  opencode: OpenCodeOverrideSchema.optional(),
  cursor: CursorOverrideSchema.optional(),
  windsurf: WindsurfOverrideSchema.optional(),
  aider: AiderOverrideSchema.optional(),
  continue: ContinueOverrideSchema.optional(),
  devin: DevinOverrideSchema.optional(),
});

// ─── Frontmatter schema (ADR-001 §7.2) ───────────────────────────────────────

export const FrontmatterSchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+$/, "version must match pattern N.N (e.g. '1.0')")
    .default("1.0"),
  scope: z.enum(["project", "workspace", "global"]).default("project"),
  metadata: z
    .object({
      name: z.string().optional(),
      team: z.string().optional(),
      updated: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be ISO 8601 date YYYY-MM-DD")
        .optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  tools: ToolOverridesSchema.optional(),
  permissions: z
    .object({
      deniedTools: z.array(z.string()).optional(),
      approvalRequired: z.array(z.string()).optional(),
      allowedTools: z.array(z.string()).optional(),
    })
    .optional(),
});

// ─── Top-level canonical document schema ─────────────────────────────────────

export const CanonicalInstructionSchema = z.object({
  frontmatter: FrontmatterSchema,
  body: z.string(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
export type CanonicalInstruction = z.infer<typeof CanonicalInstructionSchema>;
export type ToolOverrides = z.infer<typeof ToolOverridesSchema>;
