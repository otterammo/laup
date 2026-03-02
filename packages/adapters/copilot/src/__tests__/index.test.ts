import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCanonicalString } from "@laup/core";
import { describe, expect, it } from "vitest";
import { CopilotAdapter, copilotAdapter } from "../index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf-8");

describe("CopilotAdapter", () => {
  it("has correct toolId and displayName", () => {
    expect(copilotAdapter.toolId).toBe("copilot");
    expect(copilotAdapter.displayName).toBe("GitHub Copilot");
  });

  it("has category 'ide'", () => {
    expect(copilotAdapter.category).toBe("ide");
  });

  describe("render()", () => {
    it("golden-file: renders canonical input to expected output", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-output.md");
      const doc = parseCanonicalString(input);
      expect(copilotAdapter.render(doc)).toBe(expected.trimEnd());
    });

    it("prepends the generated-file comment header", () => {
      const doc = parseCanonicalString("# Body\n\nSome text.");
      expect(copilotAdapter.render(doc)).toMatch(/^<!-- laup:generated/);
    });

    it("preserves the full body content", () => {
      const body = "# My Rules\n\nDo the thing.";
      const doc = parseCanonicalString(body);
      expect(copilotAdapter.render(doc)).toContain(body);
    });

    it("does not include trailing whitespace", () => {
      const doc = parseCanonicalString("# Body\n\nText.\n\n\n");
      expect(copilotAdapter.render(doc)).not.toMatch(/\s+$/);
    });
  });

  describe("write()", () => {
    it("writes to .github/copilot-instructions.md", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = copilotAdapter.render(doc);

      const paths = copilotAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(join(targetDir, ".github", "copilot-instructions.md"));
    });

    it("creates .github directory automatically", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = copilotAdapter.render(doc);

      const [outPath] = copilotAdapter.write(rendered, targetDir);
      const written = readFileSync(outPath, "utf-8");
      expect(written).toContain("laup:generated");
    });

    it("written file ends with newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = copilotAdapter.render(doc);
      const [outPath] = copilotAdapter.write(rendered, targetDir);

      const written = readFileSync(outPath, "utf-8");
      expect(written.endsWith("\n")).toBe(true);
    });
  });

  describe("getOutputPaths()", () => {
    it("returns expected path", () => {
      const paths = copilotAdapter.getOutputPaths("/project");
      expect(paths).toEqual(["/project/.github/copilot-instructions.md"]);
    });
  });

  it("adapter is a singleton export", () => {
    expect(copilotAdapter).toBeInstanceOf(CopilotAdapter);
  });
});
