# LAUP — LLM Agent Unification Provider

> Write your project instructions once. Sync them everywhere.

LAUP is a middleware layer that solves configuration fragmentation for teams running multiple
LLM coding agents. Different tools require different instruction file formats, and supported
tools are extended over time through adapters. LAUP maintains a single canonical instruction
file and propagates it to every configured tool automatically.

## The Problem

Running multiple agents means maintaining multiple instruction files that diverge the moment
anyone edits one of them. Teams either accept drift or manually synchronize files that should be
identical.

## The Solution

```text
laup.md  ->  laup sync  ->  CLAUDE.md                  (Claude Code adapter)
                        ->  .cursorrules               (Cursor adapter)
                        ->  .cursor/rules/laup.mdc     (Cursor rules adapter)
                        ->  .aider.conf.yml + CONVENTIONS.md (Aider adapter)
                        ->  ...additional adapter outputs
```

One source of truth. One command to propagate.

## Quick Start

**Prerequisites:** Node.js >= 22, pnpm >= 9

```bash
# Build from source
git clone https://github.com/otterammo/laup
cd laup
pnpm install
pnpm run build

# Create a canonical instruction file
cat > laup.md << 'EOF'
---
version: "1.0"
scope: project
---
# My Project

Always use TypeScript strict mode.
Prefer functional patterns over class-based patterns.
Run tests before committing.
EOF

# Sync to all supported tools
node packages/cli/dist/bin.js sync --source laup.md --tools claude-code,cursor,aider
```

## Interactive Tutorial

Run a guided hands-on walkthrough that creates an isolated temporary workspace and explores
validation, sync preview, diff mode, include expansion, hierarchy inheritance, scope merging,
and import:

```bash
scripts/tutorial.sh
```

Useful options:

- `scripts/tutorial.sh --auto` runs without pause prompts
- `scripts/tutorial.sh --keep` keeps the temporary workspace for inspection

## Canonical Instruction File Format

`laup.md` uses standard Markdown with an optional YAML frontmatter block.

```markdown
---
version: "1.0"
scope: project          # project | workspace | global

# Optional per-tool overrides
tools:
  cursor:
    globs:
      - "src/**/*.ts"
    alwaysApply: false
  aider:
    model: claude-sonnet-4
    autoCommits: false
  claude-code:
    deniedTools:
      - "Bash(git push*)"

# Optional global permissions
permissions:
  deniedTools:
    - "Bash(rm -rf*)"
  approvalRequired:
    - deployments
---

# Your instructions here

Write your project instructions in plain Markdown. This body is rendered
into every tool-specific output file verbatim.
```

The frontmatter is optional. A plain Markdown file with no `---` block is valid and uses
defaults (`version: "1.0"`, `scope: project`).

## CLI Reference

```text
laup sync      Sync canonical instruction file to tool-specific output files
laup validate  Validate a canonical instruction file against the schema

Options for sync:
  --source, -s      Path to canonical instruction file (required)
  --tools, -t       Comma-separated tool IDs (default: all registered adapters)
  --output-dir, -o  Target directory for output files (default: source file directory)
  --dry-run         Preview without writing any files

Options for validate:
  --source, -s      Path to canonical instruction file (required)
```

### Examples

```bash
# Sync all tools
laup sync --source laup.md

# Sync specific tools only
laup sync --source laup.md --tools claude-code,cursor

# Preview what would be written without touching the filesystem
laup sync --source laup.md --dry-run

# Write output to a different directory
laup sync --source laup.md --output-dir /path/to/project

# Validate before syncing
laup validate --source laup.md && laup sync --source laup.md
```

## Supported Tools

| Tool | Output file(s) | Format |
| --- | --- | --- |
| `claude-code` | `CLAUDE.md` | Markdown pass-through |
| `cursor` | `.cursorrules`, `.cursor/rules/laup.mdc` | Legacy Markdown + MDC (dual-format) |
| `aider` | `.aider.conf.yml`, `CONVENTIONS.md` | YAML config + Markdown conventions |
| `codex` | `AGENTS.md` | Markdown pass-through (agents.md style) |
| `opencode` | `AGENTS.md`, `.opencode.json` (optional) | Markdown + JSON config |
| `copilot` | `.github/copilot-instructions.md` | GitHub Copilot repository instructions |

> Note: `codex` and `opencode` both target `AGENTS.md`. If you enable both in one sync run,
> whichever adapter writes last will win for that file.

## Repository Structure

```text
laup/
|-- packages/
|   |-- core/                # Schemas, parsing/validation, policy/auth/security modules
|   |-- config-hub/          # SyncEngine - orchestrates adapters
|   |-- cli/                 # laup CLI (laup sync, laup validate)
|   `-- adapters/
|       |-- claude-code/     # CLAUDE.md renderer
|       |-- cursor/          # .cursorrules + .cursor/rules/laup.mdc renderer
|       |-- aider/           # .aider.conf.yml + CONVENTIONS.md renderer
|       |-- codex/           # AGENTS.md renderer
|       |-- opencode/        # AGENTS.md + optional .opencode.json renderer
|       `-- copilot/         # .github/copilot-instructions.md renderer
|-- infra/
|   `-- docker-compose.yml   # PostgreSQL+pgvector, Redis, Vault (for Phase 2)
`-- docs/                    # Architecture and requirements docs
```

## Development

```bash
pnpm install               # Install dependencies
pnpm run build             # Compile all packages
pnpm run test:run          # Run all tests from repo root
pnpm run typecheck         # TypeScript strict check across all packages
pnpm run lint              # Markdown + machine-readable + Biome checks
pnpm run lint:md           # Markdown and MDC checks only
pnpm run lint:machine      # YAML + frontmatter + JSON/JSONC (Biome)
pnpm run lint:fix          # Safe autofix + full lint verification
pnpm run quality:baseline  # Generate quality/baseline.v1.json
pnpm run verify:local      # Local gate for changed scope (lint + typecheck + tests)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide.
See [docs/style/markdown-machine-style-guide.md](docs/style/markdown-machine-style-guide.md)
for markdown and machine-readable standards.
See [docs/skill-history.md](docs/skill-history.md) for SKILL-011 installation/usage history
storage and retention policy.
See [docs/memory-semantic-retrieval.md](docs/memory-semantic-retrieval.md) for MEM-002
semantic retrieval behavior and API usage.
See [docs/memory-scopes.md](docs/memory-scopes.md) for MEM-001 and MEM-012 memory scope and
audit trail behavior.
See [docs/external-knowledge-base.md](docs/external-knowledge-base.md) for MEM-015
read-only external knowledge base integration (Confluence/Notion connectors + sync service).
See [docs/quality-baseline.md](docs/quality-baseline.md) for QBASE-001 versioned quality
baseline generation and schema.
See [docs/zep-compatibility.md](docs/zep-compatibility.md) for MEM-006 and MEM-007
Zep-compatible session memory integration patterns, including transcript extraction.
See [docs/context-packet-format.md](docs/context-packet-format.md) for HAND-001
standard context packet format requirements.
See [docs/quality-baseline.md](docs/quality-baseline.md) for QBASE-001 quality baseline
generation and schema.
See [docs/handoff-sse.md](docs/handoff-sse.md) for HAND-012 real-time handoff
streaming integration via Server-Sent Events (SSE).

## Roadmap

LAUP's kernel (configuration sync) is Phase 1. The full platform adds:

- **Phase 2:** Skill Library (portable slash commands), Memory Layer (pgvector), Permission
  Engine (Cedar WASM), MCP Registry (single-registration), Agent Handoff (Redis transport)
- **Phase 3:** Cost & Observability (OTel), additional adapters (Gemini CLI, Windsurf,
  Continue, OpenCode, GitHub Copilot, Devin)

## License

MIT
