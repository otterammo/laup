#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { aiderAdapter } from "@laup/aider";
import { claudeCodeAdapter } from "@laup/claude-code";
import type { SyncResult } from "@laup/config-hub";
import { SyncEngine } from "@laup/config-hub";
import type { ImportFormat } from "@laup/core";
import { importDocument, serializeCanonical, validateCanonical } from "@laup/core";
import { cursorAdapter } from "@laup/cursor";

const ALL_ADAPTERS = [claudeCodeAdapter, cursorAdapter, aiderAdapter];

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    source: { type: "string", short: "s" },
    tools: { type: "string", short: "t" },
    "output-dir": { type: "string", short: "o" },
    "dry-run": { type: "boolean", default: false },
    format: { type: "string", short: "f" },
    output: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

const command = positionals[0];

const IMPORT_FORMATS = [
  "claude-code",
  "cursor",
  "cursor-mdc",
  "aider",
  "gemini",
  "windsurf",
  "opencode",
  "copilot",
];

if (!command || flags.help) {
  console.log(`laup — LLM Agent Unification Provider

Commands:
  sync      Sync canonical instruction file to tool-specific output files
  validate  Validate a canonical instruction file against the ADR-001 schema
  import    Import a tool-specific file to canonical format (CONF-013)

Options for sync:
  --source, -s      Path to canonical instruction file (required)
  --tools, -t       Comma-separated tool IDs (default: all registered adapters)
  --output-dir, -o  Target directory for output files (default: source file directory)
  --dry-run         Preview without writing any files

Options for validate:
  --source, -s      Path to canonical instruction file (required)

Options for import:
  --source, -s      Path to tool-specific file (required)
  --format, -f      Source format (auto-detected if not specified)
  --output          Output path for canonical file (default: stdout)

Supported import formats: ${IMPORT_FORMATS.join(", ")}
Registered adapters: ${ALL_ADAPTERS.map((a) => a.toolId).join(", ")}`);
  process.exit(command ? 1 : 0);
}

if (command === "validate") {
  const source = flags.source;
  if (!source) {
    console.error("Error: --source is required for validate");
    process.exit(1);
  }

  const content = readFileSync(resolve(source), "utf-8");
  const result = validateCanonical(content);

  if (result.valid) {
    console.log(`✓ ${source} is valid`);
    process.exit(0);
  } else {
    console.error(`✗ ${source} has validation errors:`);
    for (const issue of result.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }
}

if (command === "sync") {
  const source = flags.source;
  if (!source) {
    console.error("Error: --source is required for sync");
    process.exit(1);
  }

  const toolsArg = flags.tools;
  const toolIds = toolsArg ? toolsArg.split(",").map((t) => t.trim()) : [];
  const outputDir = flags["output-dir"];
  const dryRun = flags["dry-run"] ?? false;

  const engine = new SyncEngine(ALL_ADAPTERS);

  let results: SyncResult[];
  try {
    results = engine.sync({
      source: resolve(source),
      tools: toolIds,
      ...(outputDir ? { outputDir: resolve(outputDir) } : {}),
      dryRun,
    });
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let hasError = false;
  for (const result of results) {
    if (result.success) {
      if (dryRun || result.paths.length === 0) {
        console.log(`  ✓ ${result.tool}: (dry run — no files written)`);
      } else {
        for (const p of result.paths) {
          console.log(`  ✓ ${result.tool}: wrote ${p}`);
        }
      }
    } else {
      console.error(`  ✗ ${result.tool}: ${result.error}`);
      hasError = true;
    }
  }

  process.exit(hasError ? 1 : 0);
}

if (command === "import") {
  const source = flags.source;
  if (!source) {
    console.error("Error: --source is required for import");
    process.exit(1);
  }

  const format = flags.format as ImportFormat | undefined;
  const output = flags.output;

  try {
    const result = importDocument(resolve(source), format);

    // Print warnings
    for (const warning of result.warnings) {
      console.warn(`⚠ ${warning}`);
    }

    // Serialize to canonical format
    const canonical = serializeCanonical(result.document);

    if (output) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(resolve(output), canonical, "utf-8");
      console.log(`✓ Imported ${result.sourceFormat} → ${output}`);
    } else {
      console.log(canonical);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  process.exit(0);
}

console.error(`Unknown command: ${command}. Run 'laup --help' for usage.`);
process.exit(1);
