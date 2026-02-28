import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCanonicalString } from "@laup/core";
import { describe, expect, it } from "vitest";
import { CursorAdapter, cursorAdapter } from "../index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf-8");

describe("CursorAdapter", () => {
  it("has correct toolId and displayName", () => {
    expect(cursorAdapter.toolId).toBe("cursor");
    expect(cursorAdapter.displayName).toBe("Cursor");
  });

  describe("renderLegacy()", () => {
    it("golden-file: renders canonical input to expected .cursorrules output", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-legacy.md");
      const doc = parseCanonicalString(input);
      expect(cursorAdapter.renderLegacy(doc)).toBe(expected.trimEnd());
    });

    it("prepends the generated-file comment header", () => {
      const doc = parseCanonicalString("# Body\n\nSome text.");
      expect(cursorAdapter.renderLegacy(doc)).toMatch(/^<!-- laup:generated/);
    });

    it("preserves the full body content", () => {
      const body = "# My Rules\n\nDo the thing.";
      const doc = parseCanonicalString(body);
      expect(cursorAdapter.renderLegacy(doc)).toContain(body);
    });

    it("does not include trailing whitespace", () => {
      const doc = parseCanonicalString("# Body\n\nText.\n\n\n");
      expect(cursorAdapter.renderLegacy(doc)).not.toMatch(/\s+$/);
    });
  });

  describe("renderMdc()", () => {
    it("golden-file: renders canonical input to expected .mdc output", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-mdc.md");
      const doc = parseCanonicalString(input);
      expect(cursorAdapter.renderMdc(doc)).toBe(expected.trimEnd());
    });

    it("starts with YAML frontmatter delimiters", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(cursorAdapter.renderMdc(doc)).toMatch(/^---\n/);
    });

    it("includes description field in frontmatter", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(cursorAdapter.renderMdc(doc)).toContain("description:");
    });

    it("includes globs when cursor override provides them", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  cursor:",
        "    globs:",
        '      - "**/*.ts"',
        "---",
        "",
        "# Body",
        "",
        "Text.",
      ].join("\n");
      const doc = parseCanonicalString(input);
      const mdc = cursorAdapter.renderMdc(doc);
      expect(mdc).toContain("globs:");
      expect(mdc).toContain('"**/*.ts"');
    });

    it("includes alwaysApply when cursor override provides it", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  cursor:",
        "    alwaysApply: true",
        "---",
        "",
        "# Body",
        "",
        "Text.",
      ].join("\n");
      const doc = parseCanonicalString(input);
      const mdc = cursorAdapter.renderMdc(doc);
      expect(mdc).toContain("alwaysApply: true");
    });

    it("omits globs section when no cursor globs override", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(cursorAdapter.renderMdc(doc)).not.toContain("globs:");
    });

    it("does not include trailing whitespace", () => {
      const doc = parseCanonicalString("# Body\n\nText.\n\n\n");
      expect(cursorAdapter.renderMdc(doc)).not.toMatch(/\s+$/);
    });
  });

  describe("render()", () => {
    it("returns an array of [legacy, mdc] content", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const result = cursorAdapter.render(doc);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("first element is the legacy format", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const [legacy] = cursorAdapter.render(doc) as string[];
      expect(legacy).toMatch(/^<!-- laup:generated/);
    });

    it("second element is the MDC format", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const [, mdc] = cursorAdapter.render(doc) as string[];
      expect(mdc).toMatch(/^---\n/);
    });
  });

  describe("write()", () => {
    it("writes both .cursorrules and .cursor/rules/laup.mdc", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = cursorAdapter.render(doc);

      const paths = cursorAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(2);
      expect(paths[0]).toBe(join(targetDir, ".cursorrules"));
      expect(paths[1]).toBe(join(targetDir, ".cursor", "rules", "laup.mdc"));
    });

    it("written .cursorrules ends with newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = cursorAdapter.render(doc);
      const [legacyPath] = cursorAdapter.write(rendered, targetDir) as [string, string];

      const written = readFileSync(legacyPath, "utf-8");
      expect(written.endsWith("\n")).toBe(true);
    });

    it("written laup.mdc ends with newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = cursorAdapter.render(doc);
      const [, mdcPath] = cursorAdapter.write(rendered, targetDir) as [string, string];

      const written = readFileSync(mdcPath, "utf-8");
      expect(written.endsWith("\n")).toBe(true);
    });

    it("creates .cursor/rules directory automatically", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = cursorAdapter.render(doc);

      const [, mdcPath] = cursorAdapter.write(rendered, targetDir) as [string, string];
      const written = readFileSync(mdcPath, "utf-8");
      expect(written).toContain("description:");
    });
  });

  it("adapter is a singleton export", () => {
    expect(cursorAdapter).toBeInstanceOf(CursorAdapter);
  });
});
