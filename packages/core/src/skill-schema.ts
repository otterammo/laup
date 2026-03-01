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
 * Parsed skill namespace components (SKILL-007).
 */
export interface SkillNamespace {
  /** Organization/owner namespace (undefined if unnamespaced) */
  namespace?: string;
  /** Skill name within the namespace */
  name: string;
  /** Full qualified name (namespace/name or just name) */
  fullName: string;
}

/**
 * Parse a skill name into namespace components.
 */
export function parseSkillName(skillName: string): SkillNamespace {
  const parts = skillName.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return {
      namespace: parts[0],
      name: parts[1],
      fullName: skillName,
    };
  }
  return {
    name: skillName,
    fullName: skillName,
  };
}

/**
 * Check if a skill name is namespaced.
 */
export function isNamespacedSkill(skillName: string): boolean {
  return skillName.includes("/");
}

/**
 * Validate that a skill has a namespace (required for publishing).
 */
export function validateSkillNamespace(skill: Skill): {
  valid: boolean;
  error?: string;
} {
  const parsed = parseSkillName(skill.name);

  if (!parsed.namespace) {
    return {
      valid: false,
      error: `Skill "${skill.name}" must be namespaced (e.g., "org-name/${skill.name}") for publishing`,
    };
  }

  // Validate namespace format
  if (!/^[a-z][a-z0-9-]*$/i.test(parsed.namespace)) {
    return {
      valid: false,
      error: `Invalid namespace "${parsed.namespace}": must be alphanumeric with hyphens`,
    };
  }

  // Validate name format
  if (!/^[a-z][a-z0-9-]*$/i.test(parsed.name)) {
    return {
      valid: false,
      error: `Invalid skill name "${parsed.name}": must be alphanumeric with hyphens`,
    };
  }

  return { valid: true };
}

/**
 * Qualify a skill name with a namespace.
 */
export function qualifySkillName(namespace: string, name: string): string {
  // If already namespaced, return as-is
  if (name.includes("/")) {
    return name;
  }
  return `${namespace}/${name}`;
}

/**
 * Check if two skill names refer to the same skill.
 */
export function skillNamesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Check if a skill belongs to a namespace.
 */
export function skillBelongsToNamespace(skillName: string, namespace: string): boolean {
  const parsed = parseSkillName(skillName);
  return parsed.namespace?.toLowerCase() === namespace.toLowerCase();
}
