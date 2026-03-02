import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat, importDocument } from "../import.js";

describe("import detection", () => {
  it("detects Codex format from AGENTS.md", () => {
    expect(detectFormat("AGENTS.md")).toBe("codex");
    expect(detectFormat("/repo/AGENTS.md")).toBe("codex");
  });

  it("detects Claude format from CLAUDE.md", () => {
    expect(detectFormat("CLAUDE.md")).toBe("claude-code");
  });
});

describe("codex import", () => {
  it("imports AGENTS.md content as codex format", () => {
    const dir = join(tmpdir(), `laup-import-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "AGENTS.md");

    writeFileSync(
      path,
      "<!-- laup:generated — do not edit directly, edit laup.md instead -->\n\n# Rules\n\nDo tests first.\n",
      "utf-8",
    );

    const result = importDocument(path);

    expect(result.sourceFormat).toBe("codex");
    expect(result.document.frontmatter.scope).toBe("project");
    expect(result.document.body).toBe("# Rules\n\nDo tests first.");
  });

  it("supports explicit codex format", () => {
    const dir = join(tmpdir(), `laup-import-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "random.md");

    writeFileSync(path, "# Hello from Codex", "utf-8");

    const result = importDocument(path, "codex");
    expect(result.sourceFormat).toBe("codex");
    expect(result.document.body).toBe("# Hello from Codex");
  });
});
