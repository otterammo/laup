#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { aiderAdapter } from "@laup/aider";
import { claudeCodeAdapter } from "@laup/claude-code";
import type { SyncResult } from "@laup/config-hub";
import { SyncEngine } from "@laup/config-hub";
import {
  loadHierarchy,
  loadScopes,
  parseCanonical,
  processIncludes,
  validateCanonical,
} from "@laup/core";
import { cursorAdapter } from "@laup/cursor";

const ALL_ADAPTERS = [claudeCodeAdapter, cursorAdapter, aiderAdapter];

const { values: flags, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    source: { type: "string", short: "s" },
    tools: { type: "string", short: "t" },
    "output-dir": { type: "string", short: "o" },
    "dry-run": { type: "boolean", default: false },
    "merge-scopes": { type: "boolean", short: "m", default: false },
    inherit: { type: "boolean", short: "i", default: false },
    "stop-at": { type: "string" },
    "expand-includes": { type: "boolean", short: "e", default: false },
    team: { type: "string" },
    "org-path": { type: "string" },
    "teams-dir": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

const command = positionals[0];

if (!command || flags.help) {
  console.log(`laup — LLM Agent Unification Provider

Commands:
  sync      Sync canonical instruction file to tool-specific output files
  validate  Validate a canonical instruction file against the ADR-001 schema

Options for sync:
  --source, -s       Path to canonical instruction file (required)
  --tools, -t        Comma-separated tool IDs (default: all registered adapters)
  --output-dir, -o   Target directory for output files (default: source file directory)
  --dry-run          Preview without writing any files
  --inherit, -i      Load and merge parent directory instruction files (CONF-005)
  --stop-at          Stop hierarchy traversal at this directory
  --expand-includes, -e  Expand @include directives before syncing (CONF-006)
  --merge-scopes, -m Merge org/team/project configs before syncing (CONF-004)
  --team             Team name for scope merging (overrides metadata.team)
  --org-path         Path to org config (default: ~/.config/laup/org.md)
  --teams-dir        Directory containing team configs (default: ~/.config/laup/teams/)

Options for validate:
  --source, -s      Path to canonical instruction file (required)

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
  const mergeScopes = flags["merge-scopes"] ?? false;
  const inherit = flags.inherit ?? false;
  const expandIncludes = flags["expand-includes"] ?? false;
  const stopAt = flags["stop-at"];
  const team = flags.team;
  const orgPath = flags["org-path"];
  const teamsDir = flags["teams-dir"];

  const engine = new SyncEngine(ALL_ADAPTERS);

  let results: SyncResult[];
  try {
    // Load document based on mode
    let doc = parseCanonical(resolve(source));

    if (inherit) {
      // Load hierarchical instructions from parent directories (CONF-005)
      const loadResult = loadHierarchy(resolve(source), { stopAt });
      const paths = loadResult.documents.map((d) => d.path);
      console.log(`Loading hierarchy: ${paths.length} file(s)`);
      for (const p of paths) {
        console.log(`  ← ${p}`);
      }
      doc = loadResult.merged;
    } else if (mergeScopes) {
      // Load and merge documents from all scopes (CONF-004)
      const loadResult = loadScopes(resolve(source), { team, orgPath, teamsDir });
      const scopeList = loadResult.documents.map((d) => d.scope).join(" → ");
      console.log(`Merging scopes: ${scopeList}`);
      doc = loadResult.merged;
    }

    // Expand @include directives if requested (CONF-006)
    if (expandIncludes) {
      const includeResult = processIncludes(doc.body, resolve(source));
      if (includeResult.includedFiles.length > 0) {
        console.log(`Expanded includes: ${includeResult.includedFiles.length} file(s)`);
        for (const f of includeResult.includedFiles) {
          console.log(`  + ${f}`);
        }
      }
      for (const w of includeResult.warnings) {
        console.warn(`  ⚠ ${w}`);
      }
      doc = { ...doc, body: includeResult.content };
    }

    // Sync the processed document
    results = engine.syncDocument({
      document: doc,
      tools: toolIds,
      outputDir: outputDir ? resolve(outputDir) : dirname(resolve(source)),
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

console.error(`Unknown command: ${command}. Run 'laup --help' for usage.`);
process.exit(1);
