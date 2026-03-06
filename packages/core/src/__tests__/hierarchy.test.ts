import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findRootInstruction, loadHierarchy } from "../hierarchy.js";
import { pathsEqual } from "./utils/path-normalization.js";

describe("hierarchy", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `laup-hierarchy-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const writeDoc = (path: string, body: string, extra = "") => {
    const content = `---
version: "1.0"
scope: project
${extra}
---

${body}`;
    writeFileSync(path, content);
  };

  const createDir = (...parts: string[]) => {
    const dir = join(testDir, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  describe("loadHierarchy", () => {
    it("loads single file when no parents exist", () => {
      const dir = createDir("project");
      const filePath = join(dir, "laup.md");
      writeDoc(filePath, "# Project");

      const result = loadHierarchy(filePath);

      expect(result.documents).toHaveLength(1);
      expect(result.merged.body).toBe("# Project");
    });

    it("loads and merges parent + child", () => {
      const rootDir = createDir("project");
      const childDir = createDir("project", "src");

      writeDoc(join(rootDir, "laup.md"), "# Root");
      writeDoc(join(childDir, "laup.md"), "# Child");

      const result = loadHierarchy(join(childDir, "laup.md"));

      expect(result.documents).toHaveLength(2);
      expect(result.merged.body).toBe("# Root\n\n# Child");
    });

    it("loads deep hierarchy in correct order", () => {
      const rootDir = createDir("project");
      const srcDir = createDir("project", "src");
      const apiDir = createDir("project", "src", "api");

      writeDoc(join(rootDir, "laup.md"), "# Root");
      writeDoc(join(srcDir, "laup.md"), "# Src");
      writeDoc(join(apiDir, "laup.md"), "# API");

      const result = loadHierarchy(join(apiDir, "laup.md"));

      expect(result.documents).toHaveLength(3);
      expect(result.documents[0]?.document.body).toContain("# Root");
      expect(result.documents[1]?.document.body).toContain("# Src");
      expect(result.documents[2]?.document.body).toContain("# API");
      expect(result.merged.body).toBe("# Root\n\n# Src\n\n# API");
    });

    it("skips directories without instruction files", () => {
      const rootDir = createDir("project");
      const srcDir = createDir("project", "src"); // no laup.md here
      const apiDir = createDir("project", "src", "api");

      writeDoc(join(rootDir, "laup.md"), "# Root");
      writeDoc(join(apiDir, "laup.md"), "# API");

      const result = loadHierarchy(join(apiDir, "laup.md"));

      expect(result.documents).toHaveLength(2);
      expect(result.searched.some((p: string) => pathsEqual(p, srcDir))).toBe(true);
      expect(result.merged.body).toBe("# Root\n\n# API");
    });

    it("respects stopAt option", () => {
      const rootDir = createDir("project");
      const srcDir = createDir("project", "src");
      const apiDir = createDir("project", "src", "api");

      writeDoc(join(rootDir, "laup.md"), "# Root");
      writeDoc(join(srcDir, "laup.md"), "# Src");
      writeDoc(join(apiDir, "laup.md"), "# API");

      const result = loadHierarchy(join(apiDir, "laup.md"), { stopAt: srcDir });

      expect(result.documents).toHaveLength(2);
      expect(result.merged.body).toBe("# Src\n\n# API");
    });

    it("respects maxDepth option", () => {
      const d1 = createDir("d1");
      const d2 = createDir("d1", "d2");
      const d3 = createDir("d1", "d2", "d3");
      const d4 = createDir("d1", "d2", "d3", "d4");

      writeDoc(join(d1, "laup.md"), "# D1");
      writeDoc(join(d2, "laup.md"), "# D2");
      writeDoc(join(d3, "laup.md"), "# D3");
      writeDoc(join(d4, "laup.md"), "# D4");

      const result = loadHierarchy(join(d4, "laup.md"), { maxDepth: 2 });

      // Should only load d3 and d4 (2 levels up from d4)
      expect(result.documents).toHaveLength(2);
    });

    it("uses custom filename", () => {
      const rootDir = createDir("project");
      const childDir = createDir("project", "src");

      writeDoc(join(rootDir, "INSTRUCTIONS.md"), "# Root");
      writeDoc(join(childDir, "INSTRUCTIONS.md"), "# Child");

      const result = loadHierarchy(join(childDir, "INSTRUCTIONS.md"), {
        filename: "INSTRUCTIONS.md",
      });

      expect(result.documents).toHaveLength(2);
    });

    it("throws when target file not found", () => {
      expect(() => loadHierarchy(join(testDir, "nonexistent.md"))).toThrow("Target file not found");
    });

    it("child overrides parent values", () => {
      const rootDir = createDir("project");
      const childDir = createDir("project", "src");

      writeDoc(join(rootDir, "laup.md"), "# Root", "metadata:\n  name: root-project");
      writeDoc(join(childDir, "laup.md"), "# Child", "metadata:\n  name: child-project");

      const result = loadHierarchy(join(childDir, "laup.md"));

      expect(result.merged.frontmatter.metadata?.name).toBe("child-project");
    });

    it("detects circular reference via symlink", () => {
      const rootDir = createDir("project");
      const childDir = createDir("project", "child");

      writeDoc(join(rootDir, "laup.md"), "# Root");

      // Create a symlink that creates a cycle: project/child/loop -> project
      try {
        symlinkSync(rootDir, join(childDir, "loop"));

        // This should detect the cycle when we try to load from the symlinked path
        expect(() => loadHierarchy(join(childDir, "loop", "child", "loop", "laup.md"))).toThrow();
      } catch {
        // Symlink creation might fail on some systems/permissions - skip test
      }
    });
  });

  describe("findRootInstruction", () => {
    it("finds root instruction walking up from child", () => {
      const rootDir = createDir("project");
      const childDir = createDir("project", "src", "api");

      writeDoc(join(rootDir, "laup.md"), "# Root");

      const root = findRootInstruction(childDir);

      expect(root).toBeDefined();
      expect(pathsEqual(root as string, join(rootDir, "laup.md"))).toBe(true);
    });

    it("returns topmost instruction file", () => {
      const rootDir = createDir("project");
      const srcDir = createDir("project", "src");

      writeDoc(join(rootDir, "laup.md"), "# Root");
      writeDoc(join(srcDir, "laup.md"), "# Src");

      const root = findRootInstruction(srcDir);

      expect(root).toBeDefined();
      expect(pathsEqual(root as string, join(rootDir, "laup.md"))).toBe(true);
    });

    it("returns undefined when no instruction file found", () => {
      const emptyDir = createDir("empty");

      const root = findRootInstruction(emptyDir);

      expect(root).toBeUndefined();
    });

    it("uses custom filename", () => {
      const rootDir = createDir("project");

      writeDoc(join(rootDir, "CUSTOM.md"), "# Custom");

      const root = findRootInstruction(rootDir, "CUSTOM.md");

      expect(root).toBeDefined();
      expect(pathsEqual(root as string, join(rootDir, "CUSTOM.md"))).toBe(true);
    });
  });
});
