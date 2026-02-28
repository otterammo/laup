import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractIncludePaths, hasIncludes, processIncludes } from "../include.js";

describe("include", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `laup-include-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const writeFile = (name: string, content: string) => {
    const path = join(testDir, name);
    mkdirSync(join(testDir, ...name.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(path, content);
    return path;
  };

  describe("processIncludes", () => {
    it("returns content unchanged when no includes present", () => {
      const sourcePath = writeFile("main.md", "# Hello\n\nWorld");

      const result = processIncludes("# Hello\n\nWorld", sourcePath);

      expect(result.content).toBe("# Hello\n\nWorld");
      expect(result.includedFiles).toHaveLength(0);
    });

    it("expands single @include directive", () => {
      writeFile("shared/rules.md", "# Rules\n\n- Rule 1\n- Rule 2");
      const sourcePath = writeFile("main.md", "# Main\n\n@include ./shared/rules.md\n\n# End");

      const result = processIncludes("# Main\n\n@include ./shared/rules.md\n\n# End", sourcePath);

      expect(result.content).toContain("# Main");
      expect(result.content).toContain("# Rules");
      expect(result.content).toContain("- Rule 1");
      expect(result.content).toContain("# End");
      expect(result.includedFiles).toHaveLength(1);
    });

    it("expands multiple @include directives", () => {
      writeFile("a.md", "Content A");
      writeFile("b.md", "Content B");
      const sourcePath = writeFile("main.md", "@include ./a.md\n\n@include ./b.md");

      const result = processIncludes("@include ./a.md\n\n@include ./b.md", sourcePath);

      expect(result.content).toContain("Content A");
      expect(result.content).toContain("Content B");
      expect(result.includedFiles).toHaveLength(2);
    });

    it("supports quoted paths with spaces", () => {
      writeFile("path with spaces/file.md", "Spaced content");
      const sourcePath = writeFile("main.md", '@include "./path with spaces/file.md"');

      const result = processIncludes('@include "./path with spaces/file.md"', sourcePath);

      expect(result.content).toContain("Spaced content");
    });

    it("supports single-quoted paths", () => {
      writeFile("shared.md", "Single quoted");
      const sourcePath = writeFile("main.md", "@include './shared.md'");

      const result = processIncludes("@include './shared.md'", sourcePath);

      expect(result.content).toContain("Single quoted");
    });

    it("processes nested includes", () => {
      writeFile("level2.md", "Level 2 content");
      writeFile("level1.md", "Level 1\n\n@include ./level2.md");
      const sourcePath = writeFile("main.md", "Main\n\n@include ./level1.md");

      const result = processIncludes("Main\n\n@include ./level1.md", sourcePath);

      expect(result.content).toContain("Main");
      expect(result.content).toContain("Level 1");
      expect(result.content).toContain("Level 2 content");
      expect(result.includedFiles).toHaveLength(2);
    });

    it("throws on circular include", () => {
      writeFile("b.md", "@include ./a.md");
      writeFile("a.md", "@include ./b.md");
      const sourcePath = writeFile("main.md", "@include ./a.md");

      expect(() => processIncludes("@include ./a.md", sourcePath)).toThrow(
        "Circular include detected",
      );
    });

    it("throws on self-include", () => {
      const sourcePath = writeFile("main.md", "@include ./main.md");

      expect(() => processIncludes("@include ./main.md", sourcePath)).toThrow(
        "Circular include detected",
      );
    });

    it("throws when max depth exceeded", () => {
      // Create a chain of 15 includes
      for (let i = 14; i >= 1; i--) {
        writeFile(`level${i}.md`, `@include ./level${i + 1}.md`);
      }
      writeFile("level15.md", "Bottom");
      const sourcePath = writeFile("main.md", "@include ./level1.md");

      expect(() => processIncludes("@include ./level1.md", sourcePath, { maxDepth: 10 })).toThrow(
        "Maximum include depth",
      );
    });

    it("handles missing include file gracefully with warning", () => {
      const sourcePath = writeFile("main.md", "@include ./nonexistent.md");

      const result = processIncludes("@include ./nonexistent.md", sourcePath);

      expect(result.content).toContain("<!-- Include not found");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("not found");
    });

    it("resolves includes relative to including file, not source", () => {
      writeFile("shared/deep/content.md", "Deep content");
      writeFile("shared/include-deep.md", "@include ./deep/content.md");
      const sourcePath = writeFile("main.md", "@include ./shared/include-deep.md");

      const result = processIncludes("@include ./shared/include-deep.md", sourcePath);

      expect(result.content).toContain("Deep content");
    });

    it("supports absolute paths", () => {
      const absPath = writeFile("absolute.md", "Absolute content");
      const sourcePath = writeFile("main.md", `@include ${absPath}`);

      const result = processIncludes(`@include ${absPath}`, sourcePath);

      expect(result.content).toContain("Absolute content");
    });

    it("preserves non-include content", () => {
      writeFile("included.md", "INCLUDED\n");
      const sourcePath = writeFile("main.md", "before\n\n@include ./included.md\nafter");

      const result = processIncludes("before\n\n@include ./included.md\nafter", sourcePath);

      expect(result.content).toBe("before\n\nINCLUDED\n\nafter");
    });
  });

  describe("hasIncludes", () => {
    it("returns true when @include is present", () => {
      expect(hasIncludes("@include ./file.md")).toBe(true);
    });

    it("returns false when no @include is present", () => {
      expect(hasIncludes("# Just markdown\n\nNo includes here")).toBe(false);
    });

    it("returns true for quoted includes", () => {
      expect(hasIncludes('@include "file.md"')).toBe(true);
    });
  });

  describe("extractIncludePaths", () => {
    it("extracts single include path", () => {
      const paths = extractIncludePaths("@include ./file.md");

      expect(paths).toEqual(["./file.md"]);
    });

    it("extracts multiple include paths", () => {
      const paths = extractIncludePaths("@include ./a.md\n\n@include ./b.md\n\n@include ./c.md");

      expect(paths).toEqual(["./a.md", "./b.md", "./c.md"]);
    });

    it("extracts quoted paths correctly", () => {
      const paths = extractIncludePaths('@include "./path with space.md"');

      expect(paths).toEqual(["./path with space.md"]);
    });

    it("returns empty array when no includes", () => {
      const paths = extractIncludePaths("# No includes");

      expect(paths).toEqual([]);
    });
  });
});
