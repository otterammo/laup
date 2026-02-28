import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseCanonicalString } from "./parse.js";
import type { CanonicalInstruction } from "./schema.js";
import type { Scope, ScopedDocument } from "./scope.js";
import { mergeScopes } from "./scope.js";

/**
 * Configuration for scope document locations.
 */
export interface ScopeConfig {
  /** Path to organization config. Default: ~/.config/laup/org.md */
  orgPath?: string | undefined;
  /** Directory containing team configs. Default: ~/.config/laup/teams/ */
  teamsDir?: string | undefined;
  /** Team name to load. If not set, uses metadata.team from project doc. */
  team?: string | undefined;
}

/**
 * Result of loading documents from all scopes.
 */
export interface ScopeLoadResult {
  /** All documents found and loaded, in precedence order. */
  documents: ScopedDocument[];
  /** The merged result of all documents. */
  merged: CanonicalInstruction;
  /** Paths that were checked but not found. */
  notFound: string[];
}

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "laup");
const DEFAULT_ORG_PATH = join(DEFAULT_CONFIG_DIR, "org.md");
const DEFAULT_TEAMS_DIR = join(DEFAULT_CONFIG_DIR, "teams");

/**
 * Load and merge documents from all applicable scopes.
 *
 * @param projectPath - Path to the project-level laup.md file.
 * @param config - Optional configuration for scope locations.
 * @returns Load result with documents, merged result, and not-found paths.
 */
export function loadScopes(projectPath: string, config: ScopeConfig = {}): ScopeLoadResult {
  const resolvedProjectPath = resolve(projectPath);
  const documents: ScopedDocument[] = [];
  const notFound: string[] = [];

  // Load project document first (required)
  if (!existsSync(resolvedProjectPath)) {
    throw new Error(`Project document not found: ${resolvedProjectPath}`);
  }

  const projectContent = readFileSync(resolvedProjectPath, "utf-8");
  const projectDoc = parseCanonicalString(projectContent);
  const projectScoped: ScopedDocument = {
    scope: "project",
    path: resolvedProjectPath,
    document: projectDoc,
  };

  // Determine team name
  const teamName = config.team ?? projectDoc.frontmatter.metadata?.team;

  // Load org document (optional)
  const orgPath = config.orgPath ?? DEFAULT_ORG_PATH;
  if (existsSync(orgPath)) {
    const orgContent = readFileSync(orgPath, "utf-8");
    const orgDoc = parseCanonicalString(orgContent);
    documents.push({
      scope: "org",
      path: orgPath,
      document: orgDoc,
    });
  } else {
    notFound.push(orgPath);
  }

  // Load team document (optional)
  if (teamName) {
    const teamsDir = config.teamsDir ?? DEFAULT_TEAMS_DIR;
    const teamPath = join(teamsDir, `${teamName}.md`);
    if (existsSync(teamPath)) {
      const teamContent = readFileSync(teamPath, "utf-8");
      const teamDoc = parseCanonicalString(teamContent);
      documents.push({
        scope: "team",
        path: teamPath,
        document: teamDoc,
      });
    } else {
      notFound.push(teamPath);
    }
  }

  // Add project document last (highest precedence)
  documents.push(projectScoped);

  // Merge all documents
  const merged = mergeScopes(documents);

  return { documents, merged, notFound };
}

/**
 * Load a single document from a specific scope without merging.
 *
 * @param path - Path to the document.
 * @param scope - The scope this document represents.
 * @returns The scoped document.
 */
export function loadScopedDocument(path: string, scope: Scope): ScopedDocument {
  const resolvedPath = resolve(path);
  const content = readFileSync(resolvedPath, "utf-8");
  const document = parseCanonicalString(content);

  return {
    scope,
    path: resolvedPath,
    document,
  };
}

/**
 * Get the default path for a scope's document.
 */
export function getDefaultScopePath(scope: Scope, team?: string): string {
  switch (scope) {
    case "org":
      return DEFAULT_ORG_PATH;
    case "team":
      if (!team) throw new Error("Team name required for team scope path");
      return join(DEFAULT_TEAMS_DIR, `${team}.md`);
    case "project":
      return "laup.md";
  }
}
