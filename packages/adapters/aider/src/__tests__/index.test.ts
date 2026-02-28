import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCanonicalString } from "@laup/core";
import { describe, expect, it } from "vitest";
import { AiderAdapter, aiderAdapter } from "../index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf-8");

describe("AiderAdapter", () => {
  it("has correct toolId and displayName", () => {
    expect(aiderAdapter.toolId).toBe("aider");
    expect(aiderAdapter.displayName).toBe("Aider");
  });

  describe("renderConfig()", () => {
    it("golden-file: renders canonical input to expected .aider.conf.yml", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-config.yml");
      const doc = parseCanonicalString(input);
      expect(aiderAdapter.renderConfig(doc)).toBe(expected);
    });

    it("always includes read: [CONVENTIONS.md]", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(aiderAdapter.renderConfig(doc)).toContain("read:");
      expect(aiderAdapter.renderConfig(doc)).toContain("CONVENTIONS.md");
    });

    it("includes model when aider override provides it", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  aider:",
        "    model: claude-opus-4-6",
        "---",
        "",
        "# Body",
        "",
        "Text.",
      ].join("\n");
      const doc = parseCanonicalString(input);
      expect(aiderAdapter.renderConfig(doc)).toContain("model: claude-opus-4-6");
    });

    it("includes auto-commits (kebab-case) when aider override provides autoCommits", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  aider:",
        "    autoCommits: true",
        "---",
        "",
        "# Body",
        "",
        "Text.",
      ].join("\n");
      const doc = parseCanonicalString(input);
      expect(aiderAdapter.renderConfig(doc)).toContain("auto-commits: true");
    });

    it("includes editor-model (kebab-case) when aider override provides editorModel", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  aider:",
        "    editorModel: claude-haiku-4-5-20251001",
        "---",
        "",
        "# Body",
        "",
        "Text.",
      ].join("\n");
      const doc = parseCanonicalString(input);
      expect(aiderAdapter.renderConfig(doc)).toContain("editor-model: claude-haiku-4-5-20251001");
    });

    it("merges user-specified reads with CONVENTIONS.md, deduplicating", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  aider:",
        "    read:",
        "      - CONVENTIONS.md",
        "      - EXTRA.md",
        "---",
        "",
        "# Body",
        "",
        "Text.",
      ].join("\n");
      const doc = parseCanonicalString(input);
      const config = aiderAdapter.renderConfig(doc);
      const conventionsCount = (config.match(/CONVENTIONS\.md/g) ?? []).length;
      expect(conventionsCount).toBe(1);
      expect(config).toContain("EXTRA.md");
    });

    it("starts with generated comment", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(aiderAdapter.renderConfig(doc)).toMatch(/^# laup:generated/);
    });

    it("ends with a newline", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(aiderAdapter.renderConfig(doc).endsWith("\n")).toBe(true);
    });
  });

  describe("renderConventions()", () => {
    it("golden-file: renders canonical input to expected CONVENTIONS.md", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-conventions.md");
      const doc = parseCanonicalString(input);
      expect(aiderAdapter.renderConventions(doc)).toBe(expected);
    });

    it("starts with generated HTML comment", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(aiderAdapter.renderConventions(doc)).toMatch(/^<!-- laup:generated/);
    });

    it("contains the full body", () => {
      const body = "# Rules\n\nAlways do X.";
      const doc = parseCanonicalString(body);
      expect(aiderAdapter.renderConventions(doc)).toContain(body);
    });

    it("ends with a newline", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(aiderAdapter.renderConventions(doc).endsWith("\n")).toBe(true);
    });
  });

  describe("render()", () => {
    it("returns an array of [configContent, conventionsContent]", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const result = aiderAdapter.render(doc);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("first element is the YAML config", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const [config] = aiderAdapter.render(doc) as [string, string];
      expect(config).toMatch(/^# laup:generated/);
      expect(config).toContain("read:");
    });

    it("second element is the conventions markdown", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const [, conventions] = aiderAdapter.render(doc) as [string, string];
      expect(conventions).toMatch(/^<!-- laup:generated/);
    });
  });

  describe("write()", () => {
    it("writes .aider.conf.yml and CONVENTIONS.md", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = aiderAdapter.render(doc);

      const paths = aiderAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(2);
      expect(paths[0]).toBe(join(targetDir, ".aider.conf.yml"));
      expect(paths[1]).toBe(join(targetDir, "CONVENTIONS.md"));
    });

    it("written .aider.conf.yml contains YAML config", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = aiderAdapter.render(doc);
      const [configPath] = aiderAdapter.write(rendered, targetDir) as [string, string];

      const written = readFileSync(configPath, "utf-8");
      expect(written).toContain("read:");
      expect(written).toContain("CONVENTIONS.md");
    });

    it("written CONVENTIONS.md contains the body", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody content here.");
      const rendered = aiderAdapter.render(doc);
      const [, conventionsPath] = aiderAdapter.write(rendered, targetDir) as [string, string];

      const written = readFileSync(conventionsPath, "utf-8");
      expect(written).toContain("Body content here.");
    });

    it("creates the target directory if it does not exist", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`, "nested");
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = aiderAdapter.render(doc);

      const [configPath] = aiderAdapter.write(rendered, targetDir) as [string, string];
      const written = readFileSync(configPath, "utf-8");
      expect(written).toContain("CONVENTIONS.md");
    });
  });

  it("adapter is a singleton export", () => {
    expect(aiderAdapter).toBeInstanceOf(AiderAdapter);
  });
});
