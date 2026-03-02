import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCanonicalString } from "@laup/core";
import { describe, expect, it } from "vitest";
import { CodexAdapter, codexAdapter } from "../index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf-8");

describe("CodexAdapter", () => {
  it("has correct toolId and displayName", () => {
    expect(codexAdapter.toolId).toBe("codex");
    expect(codexAdapter.displayName).toBe("Codex CLI");
  });

  it("has category 'cli'", () => {
    expect(codexAdapter.category).toBe("cli");
  });

  describe("render()", () => {
    it("golden-file: renders canonical input to expected output", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-output.md");
      const doc = parseCanonicalString(input);
      expect(codexAdapter.render(doc)).toBe(expected.trimEnd());
    });

    it("prepends the generated-file comment header", () => {
      const doc = parseCanonicalString("# Body\n\nSome text.");
      expect(codexAdapter.render(doc)).toMatch(/^<!-- laup:generated/);
    });

    it("preserves the full body content", () => {
      const body = "# My Rules\n\nDo the thing.";
      const doc = parseCanonicalString(body);
      expect(codexAdapter.render(doc)).toContain(body);
    });

    it("does not include trailing whitespace", () => {
      const doc = parseCanonicalString("# Body\n\nText.\n\n\n");
      expect(codexAdapter.render(doc)).not.toMatch(/\s+$/);
    });
  });

  describe("write()", () => {
    it("writes to AGENTS.md", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = codexAdapter.render(doc);

      const paths = codexAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(join(targetDir, "AGENTS.md"));
    });

    it("creates target directory automatically", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = codexAdapter.render(doc);

      const [outPath] = codexAdapter.write(rendered, targetDir);
      const written = readFileSync(outPath, "utf-8");
      expect(written).toContain("laup:generated");
    });

    it("written file ends with newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = codexAdapter.render(doc);
      const [outPath] = codexAdapter.write(rendered, targetDir);

      const written = readFileSync(outPath, "utf-8");
      expect(written.endsWith("\n")).toBe(true);
    });
  });

  describe("getOutputPaths()", () => {
    it("returns expected path", () => {
      const paths = codexAdapter.getOutputPaths("/project");
      expect(paths).toEqual(["/project/AGENTS.md"]);
    });
  });

  it("adapter is a singleton export", () => {
    expect(codexAdapter).toBeInstanceOf(CodexAdapter);
  });
});
