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
laup sync                   # Sync to all registered adapters
laup sync -t cursor,cursor  # Sync to specific tools
laup sync --dry-run         # Preview without writing
laup validate               # Validate laup.md against schema
```

Run `laup sync --help` for full options.

## Learn More

- [Interactive tutorial](./scripts/tutorial.sh)
- [Canonical format spec](./docs/) — full frontmatter schema
- [Development guide](./CONTRIBUTING.md) — build, test, lint commands
