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
 * A step in a composed skill (SKILL-008).
 */
export const SkillStepSchema = z.object({
  /** Reference to skill ID (namespace/name format) */
  skill: z.string(),

  /** Parameter mappings: maps parent param names to child param names */
  params: z.record(z.string(), z.string()).optional(),

  /** Literal parameter values to pass */
  args: z.record(z.string(), z.unknown()).optional(),

  /** Optional step label for referencing output */
  as: z.string().optional(),

  /** Condition for running this step (expression evaluated at runtime) */
  when: z.string().optional(),
});

export type SkillStep = z.infer<typeof SkillStepSchema>;

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
 * Expected output assertion for a test case (SKILL-009).
 */
export const SkillTestAssertionSchema = z.object({
  /** Type of assertion */
  type: z.enum(["contains", "equals", "matches", "json-path"]),

  /** Expected value or pattern */
  value: z.string(),

  /** JSON path for json-path assertions */
  path: z.string().optional(),

  /** Whether the assertion is negated (must NOT match) */
  not: z.boolean().optional(),
});

export type SkillTestAssertion = z.infer<typeof SkillTestAssertionSchema>;

/**
 * A test case for a skill (SKILL-009).
 */
export const SkillTestCaseSchema = z.object({
  /** Test case name/description */
  name: z.string(),

  /** Input parameters for the test */
  params: z.record(z.string(), z.unknown()).optional(),

  /** Expected output assertions */
  expect: z.array(SkillTestAssertionSchema),

  /** Whether to skip this test */
  skip: z.boolean().optional(),

  /** Tool-specific test configuration */
  toolConfig: z.record(z.string(), z.unknown()).optional(),
});

export type SkillTestCase = z.infer<typeof SkillTestCaseSchema>;

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

  /** Composed skill steps (SKILL-008) */
  steps: z.array(SkillStepSchema).optional(),

  /** Access control (SKILL-010) */
  access: SkillAccessControlSchema.optional(),

  /** Test cases for skill validation (SKILL-009) */
  tests: z.array(SkillTestCaseSchema).optional(),
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

/**
 * Check if a skill is composed (has steps).
 */
export function isComposedSkill(skill: Skill): boolean {
  return skill.steps !== undefined && skill.steps.length > 0;
}

/**
 * Get all skill IDs referenced by a composed skill.
 */
export function getComposedSkillDependencies(skill: Skill): string[] {
  if (!skill.steps) return [];
  return skill.steps.map((step) => step.skill);
}

/**
 * Result of circular dependency detection.
 */
export interface CircularDependencyResult {
  hasCircular: boolean;
  cycle?: string[];
}

/**
 * Detect circular dependencies in composed skills.
 * @param skillName The skill to check
 * @param getSkill Function to retrieve a skill by name
 * @param visited Set of already visited skill names (for recursion)
 * @param path Current path of skill names (for cycle detection)
 */
export function detectCircularDependency(
  skillName: string,
  getSkill: (name: string) => Skill | undefined,
  visited: Set<string> = new Set(),
  path: string[] = [],
): CircularDependencyResult {
  // Normalize name for comparison
  const normalizedName = skillName.toLowerCase();

  // Check if we've already seen this skill in current path (cycle)
  if (path.includes(normalizedName)) {
    return {
      hasCircular: true,
      cycle: [...path, normalizedName],
    };
  }

  // Skip if already fully visited
  if (visited.has(normalizedName)) {
    return { hasCircular: false };
  }

  // Get the skill
  const skill = getSkill(skillName);
  if (!skill) {
    // Skill not found - can't have circular deps if it doesn't exist
    return { hasCircular: false };
  }

  // Add to current path
  const newPath = [...path, normalizedName];

  // Check dependencies
  const deps = getComposedSkillDependencies(skill);
  for (const dep of deps) {
    const result = detectCircularDependency(dep, getSkill, visited, newPath);
    if (result.hasCircular) {
      return result;
    }
  }

  // Mark as fully visited
  visited.add(normalizedName);
  return { hasCircular: false };
}

/**
 * Resolve parameter mappings for a composed skill step.
 */
export function resolveStepParams(
  step: SkillStep,
  parentParams: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  // Add literal args first
  if (step.args) {
    for (const [key, value] of Object.entries(step.args)) {
      resolved[key] = value;
    }
  }

  // Map parent params to child params
  if (step.params) {
    for (const [childParam, parentParam] of Object.entries(step.params)) {
      if (parentParam in parentParams) {
        resolved[childParam] = parentParams[parentParam];
      }
    }
  }

  return resolved;
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

/**
 * Result of a single test assertion.
 */
export interface AssertionResult {
  passed: boolean;
  assertion: SkillTestAssertion;
  actual?: string;
  message?: string;
}

/**
 * Result of running a test case.
 */
export interface TestCaseResult {
  name: string;
  passed: boolean;
  skipped: boolean;
  assertions: AssertionResult[];
  duration?: number;
  error?: string;
}

/**
 * Result of running all tests for a skill.
 */
export interface SkillTestResult {
  skill: string;
  passed: boolean;
  total: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  cases: TestCaseResult[];
}

/**
 * Run a single assertion against output.
 */
export function runAssertion(assertion: SkillTestAssertion, output: string): AssertionResult {
  let matched = false;

  switch (assertion.type) {
    case "contains":
      matched = output.includes(assertion.value);
      break;
    case "equals":
      matched = output.trim() === assertion.value.trim();
      break;
    case "matches":
      try {
        const regex = new RegExp(assertion.value);
        matched = regex.test(output);
      } catch {
        return {
          passed: false,
          assertion,
          message: `Invalid regex: ${assertion.value}`,
        };
      }
      break;
    case "json-path":
      try {
        const json = JSON.parse(output);
        const path = assertion.path ?? "$";
        const value = path === "$" ? json : getJsonPath(json, path);
        matched = String(value) === assertion.value;
      } catch {
        return {
          passed: false,
          assertion,
          actual: output.slice(0, 100),
          message: "Failed to parse output as JSON",
        };
      }
      break;
  }

  if (assertion.not) {
    matched = !matched;
  }

  const result: AssertionResult = {
    passed: matched,
    assertion,
    actual: output.slice(0, 200),
  };

  if (!matched) {
    result.message = `Expected ${assertion.not ? "NOT " : ""}${assertion.type}: ${assertion.value}`;
  }

  return result;
}

/**
 * Simple JSON path getter.
 */
function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, "").split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (part === "") continue;
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a skill has test cases.
 */
export function hasTests(skill: Skill): boolean {
  return skill.tests !== undefined && skill.tests.length > 0;
}

/**
 * Get runnable test cases (excluding skipped).
 */
export function getRunnableTests(skill: Skill): SkillTestCase[] {
  return (skill.tests ?? []).filter((t) => !t.skip);
}
