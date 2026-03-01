import { z } from "zod";

/**
 * Portable Skill Schema (SKILL-001)
 *
 * Defines a tool-agnostic skill format for reusable prompt templates.
 * Skills can be rendered to tool-specific formats by skill adapters.
 */

/**
 * Parameter type for skill inputs.
 */
export const SkillParameterTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "file",
  "selection",
]);

export type SkillParameterType = z.infer<typeof SkillParameterTypeSchema>;

/**
 * Skill parameter definition with type information and constraints.
 */
export const SkillParameterSchema = z.object({
  /** Parameter name (used in template substitution) */
  name: z.string().min(1),

  /** Human-readable description of the parameter */
  description: z.string().optional(),

  /** Parameter type */
  type: SkillParameterTypeSchema,

  /** Whether this parameter is required */
  required: z.boolean().default(true),

  /** Default value if not provided */
  default: z.unknown().optional(),

  /** For selection type: allowed values */
  options: z.array(z.string()).optional(),

  /** For array type: item type */
  items: SkillParameterTypeSchema.optional(),

  /** For string type: regex pattern */
  pattern: z.string().optional(),

  /** For number type: minimum value */
  min: z.number().optional(),

  /** For number type: maximum value */
  max: z.number().optional(),
});

export type SkillParameter = z.infer<typeof SkillParameterSchema>;

/**
 * Invocation trigger for the skill.
 */
export const SkillTriggerSchema = z.object({
  /** Slash command to invoke the skill (e.g., "/review") */
  command: z
    .string()
    .regex(/^\/[a-z][a-z0-9-]*$/i, "Command must start with / and be alphanumeric"),

  /** Keyboard shortcut (optional, tool-specific rendering) */
  shortcut: z.string().optional(),

  /** Natural language aliases for discovery */
  aliases: z.array(z.string()).optional(),
});

export type SkillTrigger = z.infer<typeof SkillTriggerSchema>;

/**
 * Skill metadata.
 */
export const SkillMetadataSchema = z.object({
  /** Author name or organization */
  author: z.string().optional(),

  /** License identifier (e.g., "MIT", "Apache-2.0") */
  license: z.string().optional(),

  /** Homepage URL */
  homepage: z.string().url().optional(),

  /** Repository URL */
  repository: z.string().url().optional(),

  /** Tags for categorization and discovery */
  tags: z.array(z.string()).optional(),

  /** Date the skill was created */
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO 8601 format YYYY-MM-DD")
    .optional(),

  /** Date the skill was last updated */
  updated: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO 8601 format YYYY-MM-DD")
    .optional(),
});

export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

/**
 * Deprecation information for a skill (SKILL-012).
 */
export const SkillDeprecationSchema = z.object({
  /** Whether the skill is deprecated */
  deprecated: z.boolean().default(false),

  /** Human-readable deprecation message */
  message: z.string().optional(),

  /** Replacement skill ID (namespace/name format) */
  replacement: z.string().optional(),

  /** Date when skill was deprecated */
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO 8601 format YYYY-MM-DD")
    .optional(),

  /** Date when skill will be removed (optional sunset date) */
  removeBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO 8601 format YYYY-MM-DD")
    .optional(),
});

export type SkillDeprecation = z.infer<typeof SkillDeprecationSchema>;

/**
 * Skill visibility levels (SKILL-010).
 */
export const SkillVisibilitySchema = z.enum([
  "public", // Visible in marketplace to everyone
  "org-private", // Visible only within the publishing organization
  "team-private", // Visible only within a specific team
  "project-private", // Visible only within a specific project
]);

export type SkillVisibility = z.infer<typeof SkillVisibilitySchema>;

/**
 * Access control configuration for a skill (SKILL-010).
 */
export const SkillAccessControlSchema = z.object({
  /** Visibility level */
  visibility: SkillVisibilitySchema.optional(),

  /** Allowed team IDs (for team-private visibility) */
  allowedTeams: z.array(z.string()).optional(),

  /** Allowed project IDs (for project-private visibility) */
  allowedProjects: z.array(z.string()).optional(),

  /** Allow installation without explicit approval */
  allowInstall: z.boolean().optional(),

  /** Allow forking/copying */
  allowFork: z.boolean().optional(),
});

export type SkillAccessControl = z.infer<typeof SkillAccessControlSchema>;

/**
 * Tool-specific override for skill rendering.
 */
export const SkillToolOverrideSchema = z.record(z.string(), z.unknown());

export type SkillToolOverride = z.infer<typeof SkillToolOverrideSchema>;

/**
 * Portable skill definition.
 */
export const SkillSchema = z.object({
  /** Schema version for the skill format */
  schemaVersion: z
    .string()
    .regex(/^\d+\.\d+$/, "Schema version must match pattern N.N")
    .default("1.0"),

  /** Unique skill name (namespace/name format recommended) */
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/i,
      "Name must be alphanumeric with optional namespace",
    ),

  /** Semantic version of the skill */
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/i, "Version must be semver format"),

  /** Human-readable description */
  description: z.string(),

  /** Parameter definitions */
  parameters: z.array(SkillParameterSchema).default([]),

  /** Invocation trigger */
  trigger: SkillTriggerSchema,

  /** Prompt template body (supports {{parameter}} substitution) */
  prompt: z.string().min(1),

  /** Optional system prompt prefix */
  system: z.string().optional(),

  /** Output format hint */
  outputFormat: z.enum(["text", "markdown", "json", "code"]).optional(),

  /** Skill metadata */
  metadata: SkillMetadataSchema.optional(),

  /** Tool-specific overrides */
  tools: z.record(z.string(), SkillToolOverrideSchema).optional(),

  /** Deprecation information (SKILL-012) */
  deprecation: SkillDeprecationSchema.optional(),

  /** Access control (SKILL-010) */
  access: SkillAccessControlSchema.optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

/**
 * Validate a skill definition.
 */
export interface SkillValidationResult {
  valid: boolean;
  skill?: Skill;
  issues: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Validate a skill object against the schema.
 */
export function validateSkill(skill: unknown): SkillValidationResult {
  const result = SkillSchema.safeParse(skill);

  if (result.success) {
    return {
      valid: true,
      skill: result.data,
      issues: [],
    };
  }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/**
 * Parse and validate a skill from YAML/JSON content.
 */
export function parseSkill(content: string): Skill {
  // Try JSON first
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try YAML
    const { load } = require("js-yaml");
    parsed = load(content);
  }

  const result = validateSkill(parsed);
  if (!result.valid) {
    const messages = result.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new Error(`Invalid skill: ${messages}`);
  }

  return result.skill!;
}

/**
 * Substitute parameters into a skill prompt.
 */
export function renderSkillPrompt(skill: Skill, params: Record<string, unknown> = {}): string {
  let prompt = skill.prompt;

  // Validate required parameters
  for (const param of skill.parameters) {
    if (param.required && !(param.name in params) && param.default === undefined) {
      throw new Error(`Missing required parameter: ${param.name}`);
    }
  }

  // Substitute parameters
  for (const param of skill.parameters) {
    const value = params[param.name] ?? param.default ?? "";
    const placeholder = `{{${param.name}}}`;
    prompt = prompt.replaceAll(placeholder, String(value));
  }

  return prompt;
}

/**
 * Check if a skill is deprecated.
 */
export function isSkillDeprecated(skill: Skill): boolean {
  return skill.deprecation?.deprecated === true;
}

/**
 * Get deprecation notice for a skill.
 * Returns null if skill is not deprecated.
 */
export function getDeprecationNotice(skill: Skill): string | null {
  if (!isSkillDeprecated(skill)) {
    return null;
  }

  const parts: string[] = [`⚠️ DEPRECATED: ${skill.name}`];

  if (skill.deprecation?.message) {
    parts.push(skill.deprecation.message);
  }

  if (skill.deprecation?.replacement) {
    parts.push(`Use "${skill.deprecation.replacement}" instead.`);
  }

  if (skill.deprecation?.removeBy) {
    parts.push(`Will be removed on ${skill.deprecation.removeBy}.`);
  }

  return parts.join(" ");
}

/**
 * Access check context for evaluating skill visibility.
 */
export interface AccessContext {
  /** ID of the user requesting access */
  userId?: string;
  /** Organization ID of the requester */
  orgId?: string;
  /** Team IDs the requester belongs to */
  teamIds?: string[];
  /** Project IDs the requester has access to */
  projectIds?: string[];
}

/**
 * Get the effective visibility of a skill.
 */
export function getSkillVisibility(skill: Skill): SkillVisibility {
  return skill.access?.visibility ?? "org-private";
}

/**
 * Check if a user can access a skill based on visibility rules.
 */
export function canAccessSkill(
  skill: Skill,
  skillOrgId: string,
  context: AccessContext,
): { allowed: boolean; reason?: string } {
  const visibility = getSkillVisibility(skill);

  // Public skills are accessible to everyone
  if (visibility === "public") {
    return { allowed: true };
  }

  // Org-private requires same org
  if (visibility === "org-private") {
    if (context.orgId === skillOrgId) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Skill "${skill.name}" is private to organization "${skillOrgId}"`,
    };
  }

  // Team-private requires team membership
  if (visibility === "team-private") {
    const allowedTeams = skill.access?.allowedTeams ?? [];
    const hasTeamAccess = context.teamIds?.some((t) => allowedTeams.includes(t));
    if (hasTeamAccess) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Skill "${skill.name}" is restricted to specific teams`,
    };
  }

  // Project-private requires project access
  if (visibility === "project-private") {
    const allowedProjects = skill.access?.allowedProjects ?? [];
    const hasProjectAccess = context.projectIds?.some((p) => allowedProjects.includes(p));
    if (hasProjectAccess) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Skill "${skill.name}" is restricted to specific projects`,
    };
  }

  return { allowed: false, reason: "Unknown visibility level" };
}

/**
 * Check if a skill allows installation.
 */
export function canInstallSkill(skill: Skill): boolean {
  return skill.access?.allowInstall !== false;
}

/**
 * Check if a skill allows forking.
 */
export function canForkSkill(skill: Skill): boolean {
  return skill.access?.allowFork !== false;
}
