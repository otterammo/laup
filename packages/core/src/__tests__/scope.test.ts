import { describe, expect, it } from "vitest";
import type { CanonicalInstruction } from "../schema.js";
import type { ScopedDocument } from "../scope.js";
import { mergeScopes, SCOPE_PRECEDENCE, scopePrecedence } from "../scope.js";

describe("scopePrecedence", () => {
  it("returns correct precedence order", () => {
    expect(scopePrecedence("org")).toBe(0);
    expect(scopePrecedence("team")).toBe(1);
    expect(scopePrecedence("project")).toBe(2);
  });

  it("SCOPE_PRECEDENCE array is ordered correctly", () => {
    expect(SCOPE_PRECEDENCE).toEqual(["org", "team", "project"]);
  });
});

describe("mergeScopes", () => {
  const createDoc = (
    scope: "project" | "team" | "org",
    body: string,
    overrides?: Partial<CanonicalInstruction["frontmatter"]>,
  ): CanonicalInstruction => ({
    frontmatter: {
      version: "1.0",
      scope,
      ...overrides,
    },
    body,
  });

  const scopedDoc = (
    scope: "project" | "team" | "org",
    body: string,
    overrides?: Partial<CanonicalInstruction["frontmatter"]>,
  ): ScopedDocument => ({
    scope,
    path: `/path/to/${scope}/laup.md`,
    document: createDoc(scope, body, overrides),
  });

  it("throws on empty documents array", () => {
    expect(() => mergeScopes([])).toThrow("Cannot merge empty documents array");
  });

  it("returns single document unchanged (except scope set)", () => {
    const doc = scopedDoc("team", "# Team Instructions");
    const result = mergeScopes([doc]);

    expect(result.body).toBe("# Team Instructions");
    expect(result.frontmatter.scope).toBe("team");
  });

  it("merges bodies with blank line separator", () => {
    const orgDoc = scopedDoc("org", "# Org Rules");
    const teamDoc = scopedDoc("team", "# Team Rules");

    const result = mergeScopes([orgDoc, teamDoc]);

    expect(result.body).toBe("# Org Rules\n\n# Team Rules");
  });

  it("merges three scopes in correct order", () => {
    const orgDoc = scopedDoc("org", "# Org");
    const teamDoc = scopedDoc("team", "# Team");
    const projectDoc = scopedDoc("project", "# Project");

    // Pass in random order to verify sorting
    const result = mergeScopes([teamDoc, projectDoc, orgDoc]);

    expect(result.body).toBe("# Org\n\n# Team\n\n# Project");
    expect(result.frontmatter.scope).toBe("project");
  });

  it("higher-precedence scope overrides version", () => {
    const orgDoc = scopedDoc("org", "body", { version: "1.0" });
    const teamDoc = scopedDoc("team", "body", { version: "2.0" });

    const result = mergeScopes([orgDoc, teamDoc]);

    expect(result.frontmatter.version).toBe("2.0");
  });

  it("merges metadata with shallow merge", () => {
    const orgDoc = scopedDoc("org", "body", {
      metadata: { name: "org-name", team: "org-team" },
    });
    const teamDoc = scopedDoc("team", "body", {
      metadata: { team: "team-override" },
    });

    const result = mergeScopes([orgDoc, teamDoc]);

    expect(result.frontmatter.metadata?.name).toBe("org-name");
    expect(result.frontmatter.metadata?.team).toBe("team-override");
  });

  it("merges tool overrides per tool", () => {
    const orgDoc = scopedDoc("org", "body", {
      tools: {
        cursor: { globs: ["**/*.ts"], alwaysApply: true },
        aider: { model: "gpt-4" },
      },
    });
    const projectDoc = scopedDoc("project", "body", {
      tools: {
        cursor: { alwaysApply: false },
      },
    });

    const result = mergeScopes([orgDoc, projectDoc]);

    expect(result.frontmatter.tools?.cursor?.globs).toEqual(["**/*.ts"]);
    expect(result.frontmatter.tools?.cursor?.alwaysApply).toBe(false);
    expect(result.frontmatter.tools?.aider?.model).toBe("gpt-4");
  });

  it("higher-precedence arrays replace lower-precedence arrays", () => {
    const orgDoc = scopedDoc("org", "body", {
      permissions: { deniedTools: ["tool-a", "tool-b"] },
    });
    const projectDoc = scopedDoc("project", "body", {
      permissions: { deniedTools: ["tool-c"] },
    });

    const result = mergeScopes([orgDoc, projectDoc]);

    expect(result.frontmatter.permissions?.deniedTools).toEqual(["tool-c"]);
  });

  it("skips empty bodies when merging", () => {
    const orgDoc = scopedDoc("org", "# Org Rules");
    const teamDoc = scopedDoc("team", "   ");
    const projectDoc = scopedDoc("project", "# Project Rules");

    const result = mergeScopes([orgDoc, teamDoc, projectDoc]);

    expect(result.body).toBe("# Org Rules\n\n# Project Rules");
  });
});
