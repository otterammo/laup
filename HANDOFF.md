# LAUP Agent Handoff

**From:** Session ending 2026-02-27
**To:** Next agent session
**Branch:** `main`
**Milestone:** Day 1 — COMPLETE ✓

---

## result

Day 1 milestone achieved. `laup sync` reads a canonical instruction file and writes
correct, validated tool-specific files for Claude Code, Cursor, and Aider.
All 74 tests pass. Zero typecheck errors. Zero lint errors. 10 commits on `main`.

---

## changes_made

### Packages implemented (all on `main`)

| Package | Path | What it does |
|---|---|---|
| `@laup/core` | `packages/core/` | ADR-001 canonical schema (Zod v4 + gray-matter), `ToolAdapter` interface, `parseCanonical`, `validateCanonical` |
| `@laup/claude-code` | `packages/adapters/claude-code/` | Writes `CLAUDE.md` — direct Markdown pass-through |
| `@laup/cursor` | `packages/adapters/cursor/` | Writes `.cursorrules` (legacy) + `.cursor/rules/laup.mdc` (MDC format) |
| `@laup/aider` | `packages/adapters/aider/` | Writes `.aider.conf.yml` + `CONVENTIONS.md` (two-file strategy) |
| `@laup/config-hub` | `packages/config-hub/` | `SyncEngine` — orchestrates adapters |
| `@laup/cli` | `packages/cli/` | `laup sync` and `laup validate` commands |

### Infrastructure in place

- Docker Compose: PostgreSQL 16 + pgvector, Redis 7, Vault dev server (`infra/docker-compose.yml`)
- GitHub Actions: CI (lint + typecheck + test on every push), release pipeline (Changesets)
- Dependabot: weekly npm + GitHub Actions updates

---

## validation

```text
Test Files  6 passed (6)
Tests       74 passed (74)
Typecheck   6 packages — zero errors
Biome       34 files — zero issues
```

Day 1 scenario verified:

```bash
node packages/cli/dist/bin.js sync --source laup.md --tools claude-code,cursor,aider
# → writes CLAUDE.md, .cursorrules, .cursor/rules/laup.mdc, .aider.conf.yml, CONVENTIONS.md
```

---

## open_items

### Immediate next step: Backlog Seeding

Read `docs/laup/phase-1-requirements/DOC-103-capability-requirements.md`
(in the docs repo at `/path/to/docs-repo/`) and generate one GitHub
Issue per requirement ID (CONF-001 through COST-012). Each issue should have:

- Requirement ID as a label (e.g. `conf`, `skill`, `mem`, `perm`, `hand`, `mcp`, `cost`)
- Classification: MUST / SHOULD / MAY from the document
- Acceptance criteria derived directly from the requirement text
- Dependency links where the requirement text references other requirements

The full requirement IDs are: `CONF-001–020`, `SKILL-001–015`, `MEM-001–015`,
`PERM-001–020`, `HAND-001–012`, `MCP-001–010`, `COST-001–012`.

### Phase 2 packages (not yet started)

These packages are scaffolded with placeholder `index.ts` files but have no implementation:

| Package | Key doc | Notes |
|---|---|---|
| `packages/skill-registry/` | DOC-203 | Skill schema, renderer per tool, marketplace API |
| `packages/memory/` | DOC-204, ADR-003 (DOC-211) | PostgreSQL + pgvector backend |
| `packages/policy-engine/` | DOC-205, ADR-002 (DOC-210) | Cedar WASM, sub-ms evaluation |
| `packages/mcp-registry/` | DOC-207 | Single-registration MCP, Vault for credentials |
| `packages/handoff/` | DOC-206, ADR-004 (DOC-212) | Agent handoff packet format, Redis transport |

### CONF requirements partially addressed

| Req | Status | Gap |
|---|---|---|
| CONF-001 | ✓ Done | Canonical schema (ADR-001) |
| CONF-002 | ✓ Done | Renderers for Claude Code, Cursor, Aider |
| CONF-003 | ✗ Open | Real-time propagation (needs watcher/daemon) |
| CONF-004 | ✗ Open | Multi-scope (project/team/org) not yet implemented |
| CONF-005 | ✗ Open | Hierarchical inheritance |
| CONF-006 | ✗ Open | `@file` include composition |
| CONF-007 | ✓ Done | Tool-specific override sections in schema |
| CONF-008 | ✓ Done | Cursor MDC with globs + alwaysApply |
| CONF-009 | ~ Partial | CLI CRUD for project scope only |
| CONF-013 | ✗ Open | Import existing tool files → canonical |
| CONF-016 | ✓ Done | `--dry-run` flag on `laup sync` |
| CONF-018 | ✓ Done | `laup validate` + pre-sync validation |
| CONF-020 | ✓ Done | `--dry-run` mode |

---

## sources_or_files

### Critical files — read these before touching any package

| File | Why |
|---|---|
| [packages/core/src/schema.ts](packages/core/src/schema.ts) | Zod v4 schemas — any schema change ripples everywhere |
| [packages/core/src/adapter.ts](packages/core/src/adapter.ts) | ToolAdapter interface — all adapters implement this |
| [packages/core/src/parse.ts](packages/core/src/parse.ts) | ParseError with `fieldIssues[]` — structured error propagation |
| [packages/config-hub/src/index.ts](packages/config-hub/src/index.ts) | SyncEngine — entry point for all sync operations |
| [packages/cli/src/bin.ts](packages/cli/src/bin.ts) | CLI binary — the user-facing entry point |
| [vitest.config.ts](vitest.config.ts) | Run tests from root only; per-package runner doesn't resolve the root config |
| [tsconfig.base.json](tsconfig.base.json) | Strict mode flags — several non-obvious settings (see Gotchas below) |

### Architecture docs (in `/path/to/docs-repo/docs/laup/`)

| Doc | Topic |
|---|---|
| `phase-2-architecture/DOC-201-system-architecture.md` | Full system architecture |
| `phase-2-architecture/DOC-202-config-hub-design.md` | Config Hub detailed design |
| `phase-2-architecture/DOC-209-adr-instruction-schema.md` | ADR-001 — canonical schema |
| `phase-2-architecture/DOC-210-adr-policy-engine.md` | ADR-002 — Cedar WASM |
| `phase-2-architecture/DOC-211-adr-memory-backend.md` | ADR-003 — PostgreSQL + pgvector |
| `phase-2-architecture/DOC-212-adr-handoff-transport.md` | ADR-004 — Redis handoff queue |
| `phase-3-development/DOC-302-tool-adapter-guide.md` | How to add a new tool adapter |
| `phase-1-requirements/DOC-103-capability-requirements.md` | All MUST/SHOULD/MAY requirements |

---

## Environment and Commands

```bash
# Install
pnpm install

# Build (must run in dependency order for type resolution)
pnpm --filter @laup/core run build
pnpm --filter @laup/claude-code run build
pnpm --filter @laup/cursor run build
pnpm --filter @laup/aider run build
pnpm --filter @laup/config-hub run build
pnpm --filter @laup/cli run build

# Or build all at once (pnpm handles order)
pnpm run build

# Test — always run from root
pnpm run test:run

# Typecheck all packages
pnpm run typecheck

# Lint
pnpm run lint

# Use the CLI
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js validate --source <file>
node packages/cli/dist/bin.js sync --source <file> --tools claude-code,cursor,aider
```

---

## Gotchas — Read Before Writing Code

### TypeScript strict flags in [tsconfig.base.json](tsconfig.base.json)

All four of these are enabled and will bite you:

1. **`noPropertyAccessFromIndexSignature: true`**
   Cannot use `obj.key` on types with `[key: string]: T` index signatures — must use `obj["key"]`.
   Zod v4's `z.looseObject()` produces such types.
   Workaround: cast with `as ConcreteType` before property access
   (see `packages/adapters/aider/src/index.ts` for the pattern).

1. **`noUncheckedIndexedAccess: true`**
   Array/object element access returns `T | undefined`.
   Array destructuring `const [a] = arr` gives `a: T | undefined`.
   Fix: `const [a] = arr as [T]` to narrow when you know the element exists.

1. **`exactOptionalPropertyTypes: true`**
   `prop?: string` means the property can be **absent** but NOT `undefined`.
   Cannot pass `{ prop: undefined }`.
   Fix: use conditional spread `...(val !== undefined ? { prop: val } : {})`.

1. **`noImplicitAnyLet: true`** (via strict)
   `let x;` without a type annotation is an error. Always annotate: `let x: MyType`.

### Biome vs TypeScript conflict

For `Record<string, unknown>` properties: Biome wants dot notation (`config.key`),
TypeScript wants bracket notation (`config["key"]`). Resolution: use a typed
interface instead of `Record<string, unknown>` - named properties can then use dot
notation, and only hyphenated keys (which are invalid identifiers anyway) require
bracket notation. See `AiderYamlConfig` in
[packages/adapters/aider/src/index.ts](packages/adapters/aider/src/index.ts).

### Zod v4 API differences from v3

| v3 | v4 |
|---|---|
| `schema.passthrough()` | `z.looseObject(shape)` |
| `schema.strict()` | `z.object(shape)` (strips unknown by default) |
| `error.errors` | `error.issues` |
| `z.record(z.unknown())` | `z.record(z.string(), z.unknown())` |

### Test runner

Always run `pnpm run test:run` from the **workspace root**.
The root `vitest.config.ts` uses `packages/**/src/__tests__/**/*.test.ts`
which matches nested adapter paths. Running vitest from a package subdirectory
picks up the root config but resolves patterns relative to the wrong directory.

### New adapter checklist

When adding a new adapter (e.g. `packages/adapters/gemini-cli/`):

1. Add package.json with `@laup/core: workspace:*` dep
1. Add tsconfig.json extending `../../../tsconfig.base.json` with
   `references: [{ path: "../../core" }]`
1. Implement `ToolAdapter` interface from `@laup/core`
1. Add golden-file tests in `src/__tests__/golden/`
1. Register adapter in `packages/cli/src/bin.ts` `ALL_ADAPTERS` array
1. Build order: core → new adapter → config-hub → cli

---

## Session context

- Docs repo: `/path/to/docs-repo/` (read-only reference)
- Implementation repo: `/path/to/implementation-repo/`
- Memory file: `~/.claude/projects/<project-id>/memory/MEMORY.md`
- Plan file: `~/.claude/plans/<plan-file>.md`
