import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCanonicalString } from "@laup/core";
import { describe, expect, it } from "vitest";
import { OpenCodeAdapter, openCodeAdapter } from "../index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "golden", name), "utf-8");

describe("OpenCodeAdapter", () => {
  it("has correct toolId and displayName", () => {
    expect(openCodeAdapter.toolId).toBe("opencode");
    expect(openCodeAdapter.displayName).toBe("OpenCode");
  });

  it("has category 'cli'", () => {
    expect(openCodeAdapter.category).toBe("cli");
  });

  describe("renderAgents()", () => {
    it("golden-file: renders canonical input to expected AGENTS.md output", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-agents.md");
      const doc = parseCanonicalString(input);
      expect(openCodeAdapter.renderAgents(doc)).toBe(expected.trimEnd());
    });

    it("prepends the generated-file comment header", () => {
      const doc = parseCanonicalString("# Body\n\nSome text.");
      expect(openCodeAdapter.renderAgents(doc)).toMatch(/^<!-- laup:generated/);
    });

    it("preserves the full body content", () => {
      const body = "# My Rules\n\nDo the thing.";
      const doc = parseCanonicalString(body);
      expect(openCodeAdapter.renderAgents(doc)).toContain(body);
    });
  });

  describe("renderConfig()", () => {
    it("golden-file: renders config when overrides present", () => {
      const input = fixture("canonical-input.md");
      const expected = fixture("expected-config.json");
      const doc = parseCanonicalString(input);
      expect(openCodeAdapter.renderConfig(doc)).toBe(expected.trimEnd());
    });

    it("returns null when no opencode overrides", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      expect(openCodeAdapter.renderConfig(doc)).toBeNull();
    });

    it("includes model in agents.coder", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  opencode:",
        '    model: "gpt-4"',
        "---",
        "",
        "# Body",
      ].join("\n");
      const doc = parseCanonicalString(input);
      const configStr = openCodeAdapter.renderConfig(doc);
      expect(configStr).not.toBeNull();
      const config = JSON.parse(configStr as string);
      expect(config.agents.coder.model).toBe("gpt-4");
    });

    it("includes autoCompact when specified", () => {
      const input = [
        "---",
        'version: "1.0"',
        "tools:",
        "  opencode:",
        "    autoCompact: false",
        "---",
        "",
        "# Body",
      ].join("\n");
      const doc = parseCanonicalString(input);
      const configStr = openCodeAdapter.renderConfig(doc);
      expect(configStr).not.toBeNull();
      const config = JSON.parse(configStr as string);
      expect(config.autoCompact).toBe(false);
    });
  });

  describe("render()", () => {
    it("returns array with agents content only when no overrides", () => {
      const doc = parseCanonicalString("# Body\n\nText.");
      const result = openCodeAdapter.render(doc);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("laup:generated");
    });

    it("returns array with agents and config when overrides present", () => {
      const input = fixture("canonical-input.md");
      const doc = parseCanonicalString(input);
      const result = openCodeAdapter.render(doc);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("laup:generated");
      expect(result[1]).toContain("_generated");
    });
  });

  describe("write()", () => {
    it("writes AGENTS.md", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = openCodeAdapter.render(doc);

      const paths = openCodeAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(join(targetDir, "AGENTS.md"));
    });

    it("writes both AGENTS.md and .opencode.json when config present", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const input = fixture("canonical-input.md");
      const doc = parseCanonicalString(input);
      const rendered = openCodeAdapter.render(doc);

      const paths = openCodeAdapter.write(rendered, targetDir);

      expect(paths).toHaveLength(2);
      expect(paths[0]).toBe(join(targetDir, "AGENTS.md"));
      expect(paths[1]).toBe(join(targetDir, ".opencode.json"));
    });

    it("creates target directory automatically", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      const doc = parseCanonicalString("# Test\n\nBody.");
      const rendered = openCodeAdapter.render(doc);

      openCodeAdapter.write(rendered, targetDir);
      expect(existsSync(join(targetDir, "AGENTS.md"))).toBe(true);
    });

    it("written files end with newline", () => {
      const targetDir = join(tmpdir(), `laup-test-${randomUUID()}`);
      mkdirSync(targetDir, { recursive: true });
      const input = fixture("canonical-input.md");
      const doc = parseCanonicalString(input);
      const rendered = openCodeAdapter.render(doc);
      openCodeAdapter.write(rendered, targetDir);

      const agents = readFileSync(join(targetDir, "AGENTS.md"), "utf-8");
      const config = readFileSync(join(targetDir, ".opencode.json"), "utf-8");
      expect(agents.endsWith("\n")).toBe(true);
      expect(config.endsWith("\n")).toBe(true);
    });
  });

  describe("getOutputPaths()", () => {
    it("returns expected paths", () => {
      const paths = openCodeAdapter.getOutputPaths("/project");
      expect(paths).toEqual(["/project/AGENTS.md", "/project/.opencode.json"]);
    });
  });

  it("adapter is a singleton export", () => {
    expect(openCodeAdapter).toBeInstanceOf(OpenCodeAdapter);
  });
});
