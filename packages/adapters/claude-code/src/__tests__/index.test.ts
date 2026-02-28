import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCanonicalString } from "@laup/core";
import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter, claudeCodeAdapter } from "../index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf-8");

describe("ClaudeCodeAdapter", () => {
  it("has correct toolId and displayName", () => {
    expect(claudeCodeAdapter.toolId).toBe("claude-code");
    expect(claudeCodeAdapter.displayName).toBe("Claude Code");
  });

  describe("render()", () => {
    it("golden-file: renders canonical input to expected CLAUDE.md output", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-output.md");
      const doc = parseCanonicalString(input);
      const rendered = claudeCodeAdapter.render(doc);
      expect(rendered).toBe(expected.trimEnd());
    });

    it("prepends the generated-file comment header", () => {
      const doc = parseCanonicalString("# Body\n\nSome text.");
      const rendered = claudeCodeAdapter.render(doc);
      expect(rendered.startsWith("<!-- laup:generated")).toBe(true);
    });

    it("preserves the full body content after the header", () => {
      const body = "# My Instructions\n\nDo the thing.";
      const doc = parseCanonicalString(body);
      const rendered = claudeCodeAdapter.render(doc);
      expect(rendered).toContain(body);
    });

    it("handles minimal body-only input without frontmatter", () => {
      const doc = parseCanonicalString("Always use TypeScript strict mode.");
      const rendered = claudeCodeAdapter.render(doc);
      expect(rendered).toContain("Always use TypeScript strict mode.");
      expect(rendered).toContain("<!-- laup:generated");
    });

    it("does not include trailing whitespace", () => {
      const doc = parseCanonicalString("# Body\n\nText.\n\n\n");
      const rendered = claudeCodeAdapter.render(doc);
      expect(rendered).not.toMatch(/\s+$/);
    });
  });

  describe("write()", () => {
    it("writes CLAUDE.md to the target directory", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody text.");
      const rendered = claudeCodeAdapter.render(doc);

      const paths = claudeCodeAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(join(targetDir, "CLAUDE.md"));
    });

    it("writes file content ending with a newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody text.");
      const rendered = claudeCodeAdapter.render(doc);

      const [outPath] = claudeCodeAdapter.write(rendered, targetDir) as [string];
      const written = readFileSync(outPath, "utf-8");

      expect(written.endsWith("\n")).toBe(true);
    });

    it("creates the target directory if it does not exist", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`, "nested", "dir");
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = claudeCodeAdapter.render(doc);

      const [outPath] = claudeCodeAdapter.write(rendered, targetDir) as [string];

      const written = readFileSync(outPath, "utf-8");
      expect(written).toContain("<!-- laup:generated");
    });

    it("written file matches rendered content plus trailing newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nContent here.");
      const rendered = claudeCodeAdapter.render(doc);

      const [outPath] = claudeCodeAdapter.write(rendered, targetDir) as [string];
      const written = readFileSync(outPath, "utf-8");

      expect(written).toBe(`${rendered}\n`);
    });
  });

  it("adapter is a singleton export", () => {
    expect(claudeCodeAdapter).toBeInstanceOf(ClaudeCodeAdapter);
  });
});
