import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultScopePath, loadScopedDocument, loadScopes } from "../scope-loader.js";

describe("scope-loader", () => {
  let testDir: string;
  let configDir: string;
  let teamsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `laup-scope-test-${Date.now()}`);
    configDir = join(testDir, "config");
    teamsDir = join(configDir, "teams");
    mkdirSync(teamsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const writeDoc = (path: string, scope: string, body: string, extra = "") => {
    const content = `---
version: "1.0"
scope: ${scope}
${extra}
---

${body}`;
    writeFileSync(path, content);
  };

  describe("loadScopes", () => {
    it("loads only project when no org/team exist", () => {
      const projectPath = join(testDir, "laup.md");
      writeDoc(projectPath, "project", "# Project");

      const result = loadScopes(projectPath, {
        orgPath: join(configDir, "org.md"),
        teamsDir,
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.scope).toBe("project");
      expect(result.notFound).toContain(join(configDir, "org.md"));
    });

    it("loads and merges org + project", () => {
      const orgPath = join(configDir, "org.md");
      const projectPath = join(testDir, "laup.md");

      writeDoc(orgPath, "org", "# Org Rules");
      writeDoc(projectPath, "project", "# Project Rules");

      const result = loadScopes(projectPath, { orgPath, teamsDir });

      expect(result.documents).toHaveLength(2);
      expect(result.merged.body).toBe("# Org Rules\n\n# Project Rules");
      expect(result.merged.frontmatter.scope).toBe("project");
    });

    it("loads and merges org + team + project", () => {
      const orgPath = join(configDir, "org.md");
      const teamPath = join(teamsDir, "backend.md");
      const projectPath = join(testDir, "laup.md");

      writeDoc(orgPath, "org", "# Org");
      writeDoc(teamPath, "team", "# Team");
      writeDoc(projectPath, "project", "# Project", "metadata:\n  team: backend");

      const result = loadScopes(projectPath, { orgPath, teamsDir });

      expect(result.documents).toHaveLength(3);
      expect(result.merged.body).toBe("# Org\n\n# Team\n\n# Project");
    });

    it("uses config.team over metadata.team", () => {
      const teamPath = join(teamsDir, "frontend.md");
      const projectPath = join(testDir, "laup.md");

      writeDoc(teamPath, "team", "# Frontend Team");
      writeDoc(projectPath, "project", "# Project", "metadata:\n  team: backend");

      const result = loadScopes(projectPath, {
        orgPath: join(configDir, "nonexistent.md"),
        teamsDir,
        team: "frontend",
      });

      expect(result.documents).toHaveLength(2);
      expect(result.documents[0]?.scope).toBe("team");
      expect(result.merged.body).toContain("Frontend Team");
    });

    it("throws when project document not found", () => {
      expect(() =>
        loadScopes(join(testDir, "nonexistent.md"), { orgPath: "", teamsDir: "" }),
      ).toThrow("Project document not found");
    });
  });

  describe("loadScopedDocument", () => {
    it("loads a document with specified scope", () => {
      const docPath = join(testDir, "test.md");
      writeDoc(docPath, "team", "# Test");

      const result = loadScopedDocument(docPath, "team");

      expect(result.scope).toBe("team");
      expect(result.path).toBe(docPath);
      expect(result.document.body).toContain("# Test");
    });
  });

  describe("getDefaultScopePath", () => {
    it("returns correct path for org scope", () => {
      const path = getDefaultScopePath("org");
      expect(path).toContain("org.md");
    });

    it("returns correct path for team scope with team name", () => {
      const path = getDefaultScopePath("team", "backend");
      expect(path).toContain("backend.md");
    });

    it("throws for team scope without team name", () => {
      expect(() => getDefaultScopePath("team")).toThrow("Team name required");
    });

    it("returns laup.md for project scope", () => {
      expect(getDefaultScopePath("project")).toBe("laup.md");
    });
  });
});
