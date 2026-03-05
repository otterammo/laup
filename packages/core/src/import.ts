import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { CanonicalInstruction, Frontmatter } from "./schema.js";

/**
 * Import result with warnings for tool-specific constructs that cannot be
 * represented canonically (CONF-013).
 */
export interface ImportResult {
  document: CanonicalInstruction;
  warnings: string[];
  sourceFormat: string;
}

/**
 * Supported import formats and their file patterns.
 */
export type ImportFormat =
  | "claude-code"
  | "codex"
  | "cursor"
  | "cursor-mdc"
  | "aider"
  | "gemini"
  | "windsurf"
  | "opencode"
  | "copilot";

const FORMAT_PATTERNS: Record<string, ImportFormat> = {
  "CLAUDE.md": "claude-code",
  "AGENTS.md": "codex",
  ".cursorrules": "cursor",
  cursorrules: "cursor",
  ".windsurfrules": "windsurf",
  windsurfrules: "windsurf",
  "GEMINI.md": "gemini",
  "opencode.md": "opencode",
  ".opencode.json": "opencode",
  "opencode.json": "opencode",
  ".aider.conf.yml": "aider",
  "aider.conf.yml": "aider",
  "copilot-instructions.md": "copilot",
};

/**
 * Detect format from filename.
 */
export function detectFormat(filePath: string): ImportFormat | null {
  const name = basename(filePath);

  // Direct match
  if (FORMAT_PATTERNS[name]) {
    return FORMAT_PATTERNS[name];
  }

  // Pattern-based detection
  if (name.endsWith(".cursorrules") || name.includes("cursorrules")) {
    return "cursor";
  }
  if (name.endsWith(".windsurfrules") || name.includes("windsurfrules")) {
    return "windsurf";
  }
  if (name.toUpperCase() === "CLAUDE.MD" || name.toLowerCase().includes("claude.md")) {
    return "claude-code";
  }
  if (name.toUpperCase() === "AGENTS.MD" || name.toLowerCase().includes("agents.md")) {
    return "codex";
  }
  if (name.toUpperCase() === "GEMINI.MD" || name.toLowerCase().includes("gemini.md")) {
    return "gemini";
  }
  if (name.toLowerCase().includes("opencode")) {
    return "opencode";
  }
  if (name.includes("aider.conf")) {
    return "aider";
  }
  if (name.includes("copilot-instructions") || name.includes("copilot")) {
    return "copilot";
  }

  // MDC files
  if (name.endsWith(".mdc")) {
    return "cursor-mdc";
  }

  return null;
}

/**
 * Import a tool-specific instruction file to canonical format.
 */
export function importDocument(filePath: string, format?: ImportFormat): ImportResult {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, "utf-8");
  const detectedFormat = format ?? detectFormat(filePath);

  if (!detectedFormat) {
    throw new Error(`Unable to detect format for: ${filePath}. Specify format explicitly.`);
  }

  switch (detectedFormat) {
    case "claude-code":
      return importClaudeCode(content);
    case "codex":
      return importCodex(content);
    case "cursor":
      return importCursor(content);
    case "cursor-mdc":
      return importCursorMdc(content);
    case "aider":
      return importAider(content, resolvedPath);
    case "gemini":
      return importGemini(content);
    case "windsurf":
      return importWindsurf(content);
    case "opencode":
      return importOpenCode(content, resolvedPath);
    case "copilot":
      return importCopilot(content);
    default:
      throw new Error(`Unsupported format: ${detectedFormat}`);
  }
}

/**
 * Strip common generated headers from content.
 */
function stripGeneratedHeader(content: string): string {
  return content
    .replace(/^<!--\s*laup:generated[^>]*-->\s*/gm, "")
    .replace(/^#\s*laup:generated[^\n]*\n/gm, "")
    .trim();
}

/**
 * Create default frontmatter.
 */
function defaultFrontmatter(): Frontmatter {
  return {
    version: "1.0",
    scope: "project",
  };
}

/**
 * Import from CLAUDE.md format.
 */
function importClaudeCode(content: string): ImportResult {
  const warnings: string[] = [];
  const body = stripGeneratedHeader(content);

  // Check for Claude-specific @file includes
  const fileIncludes = body.match(/@file\s+\S+/g);
  if (fileIncludes) {
    warnings.push(
      `Found ${fileIncludes.length} @file include(s). Convert to @include syntax manually.`,
    );
  }

  return {
    document: {
      frontmatter: defaultFrontmatter(),
      body,
    },
    warnings,
    sourceFormat: "claude-code",
  };
}

/**
 * Import from AGENTS.md (Codex) format.
 */
function importCodex(content: string): ImportResult {
  const warnings: string[] = [];
  const body = stripGeneratedHeader(content);

  return {
    document: {
      frontmatter: defaultFrontmatter(),
      body,
    },
    warnings,
    sourceFormat: "codex",
  };
}

/**
 * Import from .cursorrules format (plain Markdown).
 */
function importCursor(content: string): ImportResult {
  const warnings: string[] = [];
  const body = stripGeneratedHeader(content);

  return {
    document: {
      frontmatter: defaultFrontmatter(),
      body,
    },
    warnings,
    sourceFormat: "cursor",
  };
}

/**
 * Import from Cursor MDC format (YAML frontmatter + Markdown).
 */
function importCursorMdc(content: string): ImportResult {
  const warnings: string[] = [];
  const frontmatter = defaultFrontmatter();

  // Parse YAML frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  let body = content;

  if (frontmatterMatch) {
    const yamlContent = frontmatterMatch[1] ?? "";
    body = content.slice(frontmatterMatch[0].length);

    // Extract known fields
    const globsMatch = yamlContent.match(/globs:\s*\n((?:\s+-\s*"[^"]*"\s*\n?)+)/);
    const alwaysApplyMatch = yamlContent.match(/alwaysApply:\s*(true|false)/);
    const descriptionMatch = yamlContent.match(/description:\s*"([^"]*)"/);

    if (globsMatch || alwaysApplyMatch) {
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic tool override construction
      const cursorOverrides: any = {};

      if (globsMatch) {
        const globsContent = globsMatch[1] ?? "";
        const globs = globsContent.match(/"([^"]*)"/g)?.map((g) => g.slice(1, -1)) ?? [];
        if (globs.length > 0) {
          cursorOverrides.globs = globs;
        }
      }

      if (alwaysApplyMatch) {
        cursorOverrides.alwaysApply = alwaysApplyMatch[1] === "true";
      }

      frontmatter.tools = { cursor: cursorOverrides };
    }

    const descValue = descriptionMatch?.[1];
    if (descValue && !descValue.includes("laup:generated")) {
      frontmatter.metadata = { name: descValue };
    }
  }

  body = stripGeneratedHeader(body);

  return {
    document: { frontmatter, body },
    warnings,
    sourceFormat: "cursor-mdc",
  };
}

/**
 * Import from Aider YAML config.
 */
function importAider(content: string, filePath: string): ImportResult {
  const warnings: string[] = [];
  const frontmatter = defaultFrontmatter();

  // Parse simple YAML fields
  const modelMatch = content.match(/^model:\s*(.+)$/m);
  const editorModelMatch = content.match(/^editor-model:\s*(.+)$/m);
  const autoCommitsMatch = content.match(/^auto-commits:\s*(true|false)$/m);
  const readMatch = content.match(/^read:\s*\n((?:\s+-\s*.+\n?)+)/m);

  // biome-ignore lint/suspicious/noExplicitAny: Dynamic tool override construction
  const aiderOverrides: any = {};

  if (modelMatch?.[1]) {
    aiderOverrides.model = modelMatch[1].trim();
  }
  if (editorModelMatch?.[1]) {
    aiderOverrides.editorModel = editorModelMatch[1].trim();
  }
  if (autoCommitsMatch?.[1]) {
    aiderOverrides.autoCommits = autoCommitsMatch[1] === "true";
  }

  if (Object.keys(aiderOverrides).length > 0) {
    frontmatter.tools = { aider: aiderOverrides };
  }

  // Try to read CONVENTIONS.md if referenced
  let body = "";
  if (readMatch) {
    const readContent = readMatch[1] ?? "";
    const reads = readContent.match(/-\s*(.+)/g)?.map((r) => r.replace(/^-\s*/, "").trim()) ?? [];
    const conventionsFile = reads.find((r) => r.includes("CONVENTIONS"));

    if (conventionsFile) {
      const conventionsPath = resolve(filePath, "..", conventionsFile);
      if (existsSync(conventionsPath)) {
        body = stripGeneratedHeader(readFileSync(conventionsPath, "utf-8"));
      } else {
        warnings.push(`Referenced file not found: ${conventionsFile}`);
      }
    }

    const otherReads = reads.filter((r) => !r.includes("CONVENTIONS"));
    if (otherReads.length > 0) {
      warnings.push(
        `Additional read files not imported: ${otherReads.join(", ")}. Add as @include manually.`,
      );
    }
  }

  if (!body) {
    warnings.push("No CONVENTIONS.md found. Body is empty.");
  }

  return {
    document: { frontmatter, body },
    warnings,
    sourceFormat: "aider",
  };
}

/**
 * Import from GEMINI.md format.
 */
function importGemini(content: string): ImportResult {
  const warnings: string[] = [];
  const body = stripGeneratedHeader(content);

  return {
    document: {
      frontmatter: defaultFrontmatter(),
      body,
    },
    warnings,
    sourceFormat: "gemini",
  };
}

/**
 * Import from .windsurfrules format.
 */
function importWindsurf(content: string): ImportResult {
  const warnings: string[] = [];
  const body = stripGeneratedHeader(content);

  return {
    document: {
      frontmatter: defaultFrontmatter(),
      body,
    },
    warnings,
    sourceFormat: "windsurf",
  };
}

/**
 * Import from OpenCode format (AGENTS/opencode.md + optional .opencode.json config).
 */
function importOpenCode(content: string, filePath: string): ImportResult {
  const warnings: string[] = [];
  const frontmatter = defaultFrontmatter();
  const sourceName = basename(filePath).toLowerCase();

  let body = "";
  let configContent: string | null = null;

  if (sourceName.endsWith(".json")) {
    configContent = content;
    const agentsPath = join(dirname(filePath), "AGENTS.md");
    if (existsSync(agentsPath)) {
      body = stripGeneratedHeader(readFileSync(agentsPath, "utf-8"));
    } else {
      warnings.push("AGENTS.md not found next to OpenCode config. Body is empty.");
    }
  } else {
    body = stripGeneratedHeader(content);
    const configPath = join(dirname(filePath), ".opencode.json");
    if (existsSync(configPath)) {
      configContent = readFileSync(configPath, "utf-8");
    }
  }

  if (configContent) {
    try {
      const parsed = JSON.parse(configContent) as Record<string, unknown>;
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic tool override construction
      const opencodeOverrides: any = {};

      if (typeof parsed["autoCompact"] === "boolean") {
        opencodeOverrides.autoCompact = parsed["autoCompact"];
      }

      if (parsed["agents"] && typeof parsed["agents"] === "object") {
        const agents = parsed["agents"] as Record<string, unknown>;
        const coder =
          agents["coder"] && typeof agents["coder"] === "object"
            ? (agents["coder"] as Record<string, unknown>)
            : null;

        if (coder) {
          if (typeof coder["model"] === "string") {
            opencodeOverrides.model = coder["model"];
          }
          if (typeof coder["maxTokens"] === "number") {
            opencodeOverrides.maxTokens = coder["maxTokens"];
          }
        }
      }

      if (parsed["mcpServers"] && typeof parsed["mcpServers"] === "object") {
        opencodeOverrides.mcpServers = parsed["mcpServers"];
      }

      if (Object.keys(opencodeOverrides).length > 0) {
        frontmatter.tools = { opencode: opencodeOverrides };
      }
    } catch {
      warnings.push("Failed to parse OpenCode JSON config. Tool overrides were skipped.");
    }
  }

  return {
    document: {
      frontmatter,
      body,
    },
    warnings,
    sourceFormat: "opencode",
  };
}

/**
 * Import from GitHub Copilot instructions.
 */
function importCopilot(content: string): ImportResult {
  const warnings: string[] = [];
  const body = stripGeneratedHeader(content);

  return {
    document: {
      frontmatter: defaultFrontmatter(),
      body,
    },
    warnings,
    sourceFormat: "copilot",
  };
}

/**
 * Serialize a canonical document to laup.md format.
 */
export function serializeCanonical(doc: CanonicalInstruction): string {
  const lines: string[] = ["---"];

  lines.push(`version: "${doc.frontmatter.version}"`);
  lines.push(`scope: ${doc.frontmatter.scope}`);

  if (doc.frontmatter.metadata) {
    lines.push("metadata:");
    if (doc.frontmatter.metadata.name) {
      lines.push(`  name: "${doc.frontmatter.metadata.name}"`);
    }
    if (doc.frontmatter.metadata.team) {
      lines.push(`  team: "${doc.frontmatter.metadata.team}"`);
    }
    if (doc.frontmatter.metadata.updated) {
      lines.push(`  updated: "${doc.frontmatter.metadata.updated}"`);
    }
    if (doc.frontmatter.metadata.tags && doc.frontmatter.metadata.tags.length > 0) {
      lines.push("  tags:");
      for (const tag of doc.frontmatter.metadata.tags) {
        lines.push(`    - "${tag}"`);
      }
    }
  }

  if (doc.frontmatter.tools) {
    lines.push("tools:");
    for (const [toolId, overrides] of Object.entries(doc.frontmatter.tools)) {
      if (overrides && Object.keys(overrides).length > 0) {
        lines.push(`  ${toolId}:`);
        for (const [key, value] of Object.entries(overrides)) {
          if (Array.isArray(value)) {
            lines.push(`    ${key}:`);
            for (const item of value) {
              lines.push(`      - "${item}"`);
            }
          } else if (typeof value === "boolean") {
            lines.push(`    ${key}: ${value}`);
          } else if (typeof value === "string") {
            lines.push(`    ${key}: "${value}"`);
          }
        }
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(doc.body);

  return lines.join("\n");
}
