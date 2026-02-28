import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ParseError, parseCanonicalString, validateCanonical } from "../index.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");

describe("parseCanonicalString", () => {
  it("parses a full canonical file with frontmatter and body", () => {
    const doc = parseCanonicalString(fixture("valid-full.md"));

    expect(doc.frontmatter.version).toBe("1.0");
    expect(doc.frontmatter.scope).toBe("project");
    expect(doc.frontmatter.metadata?.name).toBe("acme-platform");
    expect(doc.frontmatter.tools?.cursor?.globs).toEqual(["src/**/*.ts", "src/**/*.tsx"]);
    expect(doc.frontmatter.tools?.aider?.model).toBe("claude-sonnet-4-6");
    expect(doc.frontmatter.permissions?.deniedTools).toContain("Bash(rm -rf*)");
    expect(doc.body).toContain("# Project Instructions");
    expect(doc.body).toContain("TypeScript strict mode");
  });

  it("parses a minimal body-only file with default frontmatter values", () => {
    const doc = parseCanonicalString(fixture("valid-minimal.md"));

    expect(doc.frontmatter.version).toBe("1.0");
    expect(doc.frontmatter.scope).toBe("project");
    expect(doc.frontmatter.tools).toBeUndefined();
    expect(doc.frontmatter.permissions).toBeUndefined();
    expect(doc.body).toContain("TypeScript strict mode");
  });

  it("throws ParseError for invalid version pattern", () => {
    expect(() => parseCanonicalString(fixture("invalid-bad-version.md"))).toThrow(ParseError);
  });

  it("throws ParseError for malformed YAML frontmatter", () => {
    const malformed = "---\nversion: [unclosed\n---\n\n# Body";
    expect(() => parseCanonicalString(malformed)).toThrow(ParseError);
  });
});

describe("validateCanonical", () => {
  it("returns valid=true for a full canonical file", () => {
    const result = validateCanonical(fixture("valid-full.md"));
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns valid=true for a minimal body-only file", () => {
    const result = validateCanonical(fixture("valid-minimal.md"));
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns valid=false with issue for bad version pattern", () => {
    const result = validateCanonical(fixture("invalid-bad-version.md"));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes("version"))).toBe(true);
  });

  it("returns valid=false with issue for empty body", () => {
    const result = validateCanonical(fixture("invalid-empty-body.md"));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "body")).toBe(true);
  });

  it("flags unknown tool identifier as an issue", () => {
    const withUnknownTool = [
      "---",
      'version: "1.0"',
      "tools:",
      "  unknown-tool:",
      "    someKey: value",
      "---",
      "",
      "# Instructions",
      "",
      "Body text here.",
    ].join("\n");
    const result = validateCanonical(withUnknownTool);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes("unknown-tool"))).toBe(true);
  });
});
