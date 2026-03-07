# LAUP — LLM Agent Unification Provider

> Write your project instructions once. Sync them everywhere.

LAUP unifies configuration across AI coding tools. Maintain a single canonical instruction file and automatically propagate it to Claude Code, Cursor, Copilot, Aider, Codex, and OpenCode.

## The Problem

Every AI coding tool has its own config format—`CLAUDE.md`, `.cursorrules`, `.aider.conf.yml`, `AGENTS.md`. When engineering standards change, updating six files across every project is unsustainable. Governance is impossible.

## The Solution

```text
laup.md  →  laup sync  →  CLAUDE.md        (Claude Code)
                      →  .cursorrules      (Cursor)
                      →  .aider.conf.yml   (Aider)
                      →  ...
```

Write standards once. Sync everywhere.

## Quick Start

**Requirements:** Node.js >= 22, pnpm >= 9

```bash
git clone https://github.com/otterammo/laup
cd laup
pnpm install && pnpm run build

# Create laup.md, then sync to tools
node packages/cli/dist/bin.js sync --source laup.md --tools claude-code,cursor,aider
```

## Commands

```bash
laup sync           # Sync canonical file to all tools
laup sync -t cursor # Sync to specific tool(s)
laup sync --dry-run # Preview changes without writing
laup validate       # Validate against ADR-001 schema
laup import         # Import tool-specific file to canonical format
laup handoff        # Render context handoff templates
```

## Key Features

- **Canonical format** — Single source of truth (ADR-001 schema)
- **Multi-tool sync** — Claude Code, Cursor, Aider, Codex, OpenCode, Copilot
- **Scope inheritance** — Team → org → global hierarchy with precedence rules
- **Include directives** — Compose configs from fragments
- **Import/Export** — Convert existing tool configs to canonical format

## Enterprise Features

LAUP includes production-grade services for governing AI tool usage at scale:

- **Authentication** — API keys, OAuth 2.0, SAML 2.0
- **Authorization** — Role-based access control (RBAC), permission policies
- **Policy engine** — Approval gates, rate limiting, resource guards, kill switches
- **Cost attribution** — Track usage by skill, team, project; generate chargeback reports
- **Memory systems** — Persistent context with Mem0 and Zep integrations
- **MCP integration** — Registry, capability discovery, federation across organizations
- **Handoff** — Transfer context between tools via SSE streaming with templates
- **Audit & compliance** — Full activity logging, anomaly detection, compliance reports

## Links

- [Canonical format spec](./docs/)
- [Interactive tutorial](./scripts/tutorial.sh)
- [Contributing guide](./CONTRIBUTING.md)
- [CHANGELOG](./CHANGELOG.md)
