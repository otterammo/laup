# AGENTS.md

Operating standard for AI agents working in this repository.
Extends the base standard at `/path/to/docs-repo/AGENTS.md`.

---

## Core Rule

Optimize for correct outcomes with minimal changes, minimal tokens, and clear traceability.
Read before writing. Verify after changing.

---

## Task Execution Loop

1. **Understand** - read the relevant files and constraints before writing anything
1. **Plan** - define concrete steps; surface blockers before starting
1. **Execute** - focused, surgical edits; no unrelated refactors
1. **Verify** - run the narrowest meaningful check for the changed scope
1. **Report** - summarize `result`, `changes_made`, `validation`, `open_items`,
   `sources_or_files`

---

## Repository Map

```text
packages/core/               Canonical schema, ToolAdapter interface, parse/validate
packages/config-hub/         SyncEngine - orchestrates adapters
packages/cli/src/bin.ts      laup CLI entry point
packages/adapters/claude-code/
packages/adapters/cursor/
packages/adapters/aider/
infra/docker-compose.yml     PostgreSQL+pgvector, Redis, Vault
```

**Dependency order (build and import):**
`core -> adapters/* -> config-hub -> cli`

---

## Commands

```bash
pnpm run build          # Compile all packages (respects dependency order)
pnpm run test:run       # All tests - always run from workspace root
pnpm run typecheck      # TypeScript strict check across all packages
pnpm run lint           # Markdown + machine-readable + Biome checks
pnpm run lint:fix       # Safe autofix + full lint verification
```

> Always run `pnpm run test:run` from the **workspace root**, not from a package subdirectory.

---

## Strict TypeScript Rules

Four flags beyond `strict: true` are active. Violations produce compile errors.

| Flag | What it means | Pattern |
| --- | --- | --- |
| `noPropertyAccessFromIndexSignature` | Dot notation forbidden on index-signature types | Use `obj["key"]` or cast `as ConcreteType` |
| `noUncheckedIndexedAccess` | Array access returns `T \| undefined` | Use `as [T]` cast on destructured arrays you know are non-empty |
| `exactOptionalPropertyTypes` | `prop?: T` cannot be set to `undefined` | Use `...(val ? { prop: val } : {})` |
| `noImplicitAnyLet` | `let x;` without annotation is an error | Always annotate: `let x: MyType` |

**Biome + TypeScript conflict on `Record<string, unknown>`:** Biome wants dot notation,
TypeScript requires bracket notation for index-signature types. Resolution: use a typed
interface with named properties. See `AiderYamlConfig` in
[packages/adapters/aider/src/index.ts](packages/adapters/aider/src/index.ts).

---

## Zod v4 API

| v3 | v4 |
| --- | --- |
| `.passthrough()` | `z.looseObject(shape)` |
| `.strict()` | `z.object(shape)` (strips unknown by default) |
| `error.errors` | `error.issues` |
| `z.record(z.unknown())` | `z.record(z.string(), z.unknown())` |

`z.looseObject()` produces a type with `[key: string]: unknown`.
When accessing named properties on its inferred type, cast first:
`const x = doc.frontmatter.tools?.aider as AiderOverrides | undefined`.

---

## Adding a New Adapter

1. Scaffold package under `packages/adapters/<tool-id>/` with `package.json`, `tsconfig.json`
   (references `../../core`), `src/index.ts`, and `src/__tests__/index.test.ts`
1. Implement `ToolAdapter` from `@laup/core` (`toolId`, `displayName`, `render()`, `write()`)
1. Create golden files: `src/__tests__/golden/canonical-input.md` + expected output(s)
1. Add to `ALL_ADAPTERS` in `packages/cli/src/bin.ts` and add dependency in
   `packages/cli/package.json`
1. `pnpm install && pnpm run build && pnpm run test:run && pnpm run typecheck && pnpm run lint`

Reference: `packages/adapters/claude-code/` is the simplest complete example.

---

## Testing Rules

- Golden-file tests are mandatory for every adapter: canonical input -> expected rendered output
- Run all tests from root: `pnpm run test:run`
- Tests for config-hub and CLI are integration tests.
  They write to `os.tmpdir()` and verify output files.
- Do not mock the filesystem in adapter tests; use real temp directories

---

## Commit Format

Conventional Commits are enforced by the `commit-msg` hook:

```text
feat(scope): description
fix(core): description
chore(deps): description
```

Scopes: `core`, `cli`, `config-hub`, `adapters/claude-code`, `adapters/cursor`,
`adapters/aider`.

---

## Communication Contract

Every completed task report must include:

- `result` - what was achieved
- `changes_made` - files changed and why
- `validation` - test/typecheck/lint output confirming the change works
- `open_items` - anything not done, deferred, or requiring human decision
- `sources_or_files` - key files read or modified
