import type { CanonicalInstruction, Frontmatter } from "./schema.js";

/**
 * Configuration scope hierarchy (most specific to least specific).
 *
 * Merge semantics (CONF-004):
 * - `org`: Organization-wide defaults. Lowest precedence.
 * - `team`: Team-level settings. Overrides org.
 * - `project`: Project-specific settings. Highest precedence, overrides all.
 *
 * When merging, more specific scopes override less specific scopes.
 * Within each scope, arrays are replaced (not concatenated) and objects are shallow-merged.
 */
export type Scope = "project" | "team" | "org";

/** Precedence order: higher index = higher precedence (overrides lower). */
export const SCOPE_PRECEDENCE: readonly Scope[] = ["org", "team", "project"] as const;

/**
 * Returns the precedence level of a scope. Higher = more specific.
 */
export function scopePrecedence(scope: Scope): number {
  return SCOPE_PRECEDENCE.indexOf(scope);
}

/**
 * A document loaded from a specific scope with its source path.
 */
export interface ScopedDocument {
  scope: Scope;
  path: string;
  document: CanonicalInstruction;
}

/**
 * Merge multiple scoped documents into a single resolved document.
 *
 * Merge rules (CONF-004):
 * 1. Documents are sorted by precedence (org < team < project).
 * 2. Bodies are concatenated with a blank line separator.
 * 3. Frontmatter fields are merged with higher-precedence scopes overriding lower.
 * 4. Arrays are replaced entirely (no concatenation).
 * 5. Objects are shallow-merged (keys from higher precedence override).
 * 6. The resulting scope is the highest-precedence scope present.
 *
 * @param documents - Array of scoped documents to merge.
 * @returns Merged canonical instruction document.
 * @throws Error if documents array is empty.
 */
export function mergeScopes(documents: ScopedDocument[]): CanonicalInstruction {
  if (documents.length === 0) {
    throw new Error("Cannot merge empty documents array");
  }

  // Sort by precedence (lowest first, so higher-precedence docs override)
  const sorted = [...documents].sort((a, b) => scopePrecedence(a.scope) - scopePrecedence(b.scope));

  // Start with the lowest-precedence document
  const [first, ...rest] = sorted as [ScopedDocument, ...ScopedDocument[]];
  let merged: CanonicalInstruction = structuredClone(first.document);

  for (const doc of rest) {
    merged = mergeTwoDocuments(merged, doc.document);
  }

  // Set scope to highest-precedence scope present
  const highestScope = sorted[sorted.length - 1]?.scope ?? "project";
  merged.frontmatter.scope = highestScope;

  return merged;
}

/**
 * Merge two documents, with `override` taking precedence over `base`.
 */
function mergeTwoDocuments(
  base: CanonicalInstruction,
  override: CanonicalInstruction,
): CanonicalInstruction {
  return {
    frontmatter: mergeFrontmatter(base.frontmatter, override.frontmatter),
    body: mergeBody(base.body, override.body),
  };
}

/**
 * Merge frontmatter objects. Override values replace base values.
 * Objects are shallow-merged; arrays are replaced.
 */
function mergeFrontmatter(base: Frontmatter, override: Frontmatter): Frontmatter {
  const result: Frontmatter = { ...base };

  // Version: use override if present
  if (override.version) {
    result.version = override.version;
  }

  // Scope: will be set by mergeScopes, but use override for now
  if (override.scope) {
    result.scope = override.scope;
  }

  // Metadata: shallow merge
  if (override.metadata) {
    result.metadata = { ...base.metadata, ...override.metadata };
  }

  // Tools: shallow merge per tool, arrays replaced
  if (override.tools) {
    result.tools = mergeToolOverrides(base.tools, override.tools);
  }

  // Permissions: shallow merge, arrays replaced
  if (override.permissions) {
    result.permissions = { ...base.permissions, ...override.permissions };
  }

  return result;
}

/**
 * Merge tool overrides. Each tool's config is shallow-merged.
 */
function mergeToolOverrides(
  base: Frontmatter["tools"],
  override: Frontmatter["tools"],
): Frontmatter["tools"] {
  if (!base) return override;
  if (!override) return base;

  const result: NonNullable<Frontmatter["tools"]> = { ...base };

  for (const [toolId, toolOverride] of Object.entries(override)) {
    const baseConfig = result[toolId as keyof typeof result];
    if (baseConfig && typeof baseConfig === "object" && typeof toolOverride === "object") {
      (result as Record<string, unknown>)[toolId] = { ...baseConfig, ...toolOverride };
    } else {
      (result as Record<string, unknown>)[toolId] = toolOverride;
    }
  }

  return result;
}

/**
 * Merge bodies by concatenating with a blank line separator.
 * Empty bodies are skipped.
 */
function mergeBody(base: string, override: string): string {
  const baseTrimmed = base.trim();
  const overrideTrimmed = override.trim();

  if (!baseTrimmed) return overrideTrimmed;
  if (!overrideTrimmed) return baseTrimmed;

  return `${baseTrimmed}\n\n${overrideTrimmed}`;
}
