# LAUP — LLM Agent Unification Provider

> Write your project instructions once. Sync them everywhere.

LAUP is a middleware layer that solves configuration fragmentation for teams running multiple LLM coding agents. Maintain a single canonical instruction file and propagate it to every tool automatically.

## Quick Start

**Prerequisites:** Node.js >= 22, pnpm >= 9

```bash
git clone https://github.com/otterammo/laup
cd laup
pnpm install && pnpm run build

# Create laup.md, then sync to tools
node packages/cli/dist/bin.js sync --source laup.md --tools claude-code,cursor,aider
```

## How It Works

```text
laup.md  ->  laup sync  ->  CLAUDE.md         (Claude Code)
                        ->  .cursorrules      (Cursor)
                        ->  .aider.conf.yml   (Aider)
                        ->  ...
```

## Supported Tools

| Tool          | Output                            |
| ------------- | --------------------------------- |
| `claude-code` | `CLAUDE.md`                       |
| `cursor`      | `.cursorrules`                    |
| `aider`       | `.aider.conf.yml`                 |
| `codex`       | `AGENTS.md`                       |
| `opencode`    | `AGENTS.md`                       |
| `copilot`     | `.github/copilot-instructions.md` |

## CLI

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
pnpm run quality:validate-gaps  # Validate quality gap tracking (QBASE-002)
pnpm run quality:validate-questions  # Validate challenge questions (QBASE-003)
pnpm run quality:check-diff-coverage  # Check diff coverage for changed lines (CIG-003)
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
See [docs/quality-gap-tracking.md](docs/quality-gap-tracking.md) for QBASE-002 quality gap
ownership tracking and remediation workflow.
See [docs/challenge-questions.md](docs/challenge-questions.md) for QBASE-003 challenge
questions that must be resolved before hard-gate rollout (Phase 3 progression).
See [docs/coverage-threshold.md](docs/coverage-threshold.md) for CIG-003 coverage threshold
and diff coverage gate implementation (DOC-620).
See [docs/zep-compatibility.md](docs/zep-compatibility.md) for MEM-006 and MEM-007
Zep-compatible session memory integration patterns, including transcript extraction.
See [docs/context-packet-format.md](docs/context-packet-format.md) for HAND-001
standard context packet format requirements.
See [docs/handoff-sse.md](docs/handoff-sse.md) for HAND-012 real-time handoff
streaming integration via Server-Sent Events (SSE).

## Learn More

- [Interactive tutorial](./scripts/tutorial.sh)
- [Canonical format spec](./docs/) — full frontmatter schema
- [Development guide](./CONTRIBUTING.md) — build, test, lint commands
