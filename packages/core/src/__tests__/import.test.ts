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

describe("opencode import", () => {
  it("imports mcpServers from .opencode.json alongside AGENTS.md", () => {
    const dir = join(tmpdir(), `laup-import-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, "AGENTS.md"), "# OpenCode Rules\n\nUse tests.", "utf-8");
    writeFileSync(
      join(dir, ".opencode.json"),
      JSON.stringify(
        {
          agents: { coder: { model: "claude-3.7-sonnet", maxTokens: 4000 } },
          autoCompact: true,
          mcpServers: {
            docs: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = importDocument(join(dir, "AGENTS.md"), "opencode");

    expect(result.document.body).toBe("# OpenCode Rules\n\nUse tests.");
    expect(result.document.frontmatter.tools?.opencode).toMatchObject({
      model: "claude-3.7-sonnet",
      maxTokens: 4000,
      autoCompact: true,
      mcpServers: {
        docs: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
      },
    });
  });

  it("imports from .opencode.json and reads AGENTS.md body when present", () => {
    const dir = join(tmpdir(), `laup-import-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, "AGENTS.md"), "# Rules\n\nPrefer strict mode.", "utf-8");
    const configPath = join(dir, ".opencode.json");
    writeFileSync(
      configPath,
      '{"mcpServers":{"search":{"type":"http","url":"https://mcp.example.com"}}}',
      "utf-8",
    );

    const result = importDocument(configPath);

    expect(result.sourceFormat).toBe("opencode");
    expect(result.document.body).toBe("# Rules\n\nPrefer strict mode.");
    expect(result.document.frontmatter.tools?.opencode).toMatchObject({
      mcpServers: {
        search: { type: "http", url: "https://mcp.example.com" },
      },
    });
  });
});
