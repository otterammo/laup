# Contributing

## Prerequisites

- Node.js >= 22 (`node --version`)
- pnpm >= 9 (`pnpm --version`)
- Docker (for Phase 2 integration tests)

## Setup

```bash
git clone https://github.com/your-org/laup
cd laup
pnpm install
pnpm run build
pnpm run test:run
```

All tests should pass before you make any changes.

## Repository Layout

```text
packages/
  core/              # Canonical schema, ToolAdapter interface, parse/validate
  config-hub/        # SyncEngine
  cli/               # laup binary
  adapters/
    claude-code/
    cursor/
    aider/
```

Each package is independent with its own `package.json`, `tsconfig.json`, and tests.
All packages are linked via pnpm workspaces.

## Development Workflow

### Branch naming

```text
feat/<short-description>     # New feature
fix/<short-description>      # Bug fix
chore/<short-description>    # Maintenance, deps, config
docs/<short-description>     # Documentation only
```

### Commit format

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(scope): short description
fix(core): correct validation error path for nested fields
chore(deps): update js-yaml to 4.1.1
```

The `commit-msg` hook enforces this. Scopes should match the package name:
`core`, `cli`, `config-hub`, `adapters/claude-code`, etc.

### Build order

Packages have the following dependency chain. Build in this order when compiling from scratch:

```text
core -> adapters/* -> config-hub -> cli
```

`pnpm run build` handles this automatically via pnpm's recursive mode.

### Running tests

Always run tests from the **workspace root**:

```bash
pnpm run test:run       # All packages, one run
pnpm run test:run       # Re-run after changes
```

Do not run `vitest` directly from a package subdirectory.
The root config uses a glob pattern that resolves correctly only from the root.

To run a single test file during development:

```bash
pnpm run test:run -- packages/adapters/claude-code/src/__tests__/index.test.ts
```

### Typecheck

```bash
pnpm run typecheck      # All packages
```

TypeScript is configured with several strict flags beyond `strict: true`.
Read the **TypeScript gotchas** section below before writing new code.

### Lint

```bash
pnpm run lint              # Full gate: markdown + machine-readable + Biome
pnpm run lint:fix          # Safe autofix + full lint verification
pnpm run lint:md           # Markdown and MDC rules
pnpm run lint:machine      # YAML + frontmatter + JSON/JSONC checks
pnpm run lint:yaml         # YAML parser/style checks
pnpm run lint:frontmatter  # Markdown/MDC frontmatter checks
```

Linting is blocking in CI and pre-commit. `lint-staged` runs on changed files:

- `*.{ts,tsx,js,jsx,json}`: Biome write/check
- `*.{md,mdc}`: markdownlint + frontmatter validation
- `*.{yml,yaml}`: YAML validator/fix + check (`pnpm-lock.yaml` excluded)

See [docs/style/markdown-machine-style-guide.md](docs/style/markdown-machine-style-guide.md)
for the full markdown/machine-readable style contract and exception process.

### Exception policy for lint rules

If an exception is required:

1. Scope it as narrowly as possible (single file or narrow glob).
1. Document the reason in config and in the PR description.
1. Do not disable unrelated rules.
1. Prefer generated-file-only exceptions over authored-doc exceptions.

---

## Adding a New Adapter

To add support for a new tool (e.g. Gemini CLI):

### 1. Scaffold the package

```bash
mkdir -p packages/adapters/gemini-cli/src/__tests__/golden
```

Create `packages/adapters/gemini-cli/package.json`:

```json
{
  "name": "@laup/gemini-cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test:run": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": { "@laup/core": "workspace:*" },
  "devDependencies": { "typescript": "*", "vitest": "^2.1.8" }
}
```

Create `packages/adapters/gemini-cli/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
  "exclude": ["node_modules", "dist"],
  "references": [{ "path": "../../core" }]
}
```

### 2. Implement the ToolAdapter interface

```typescript
// packages/adapters/gemini-cli/src/index.ts
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";

export class GeminiCliAdapter implements ToolAdapter {
  readonly toolId = "gemini-cli";
  readonly displayName = "Gemini CLI";

  render(doc: CanonicalInstruction): string {
    // Transform doc.body into the tool's native format
  }

  write(rendered: string, targetDir: string): string[] {
    // Write the file(s) and return the paths written
  }
}

export const geminiCliAdapter = new GeminiCliAdapter();
```

### 3. Add golden-file tests

Create `packages/adapters/gemini-cli/src/__tests__/golden/canonical-input.md`
with representative canonical input, and `expected-output.md` with the exact
expected rendered output.

Write tests in `packages/adapters/gemini-cli/src/__tests__/index.test.ts` that:

- Compare rendered output against the golden file
- Test `write()` creates the correct files
- Cover edge cases (minimal input, tool overrides)

### 4. Register in the CLI

Edit `packages/cli/src/bin.ts`:

```typescript
import { geminiCliAdapter } from "@laup/gemini-cli";

const ALL_ADAPTERS = [claudeCodeAdapter, cursorAdapter, aiderAdapter, geminiCliAdapter];
```

Add the dependency to `packages/cli/package.json`:

```json
"dependencies": {
  "@laup/gemini-cli": "workspace:*"
}
```

### 5. Run the full suite

```bash
pnpm install
pnpm run build
pnpm run test:run
pnpm run typecheck
pnpm run lint
```

---

## TypeScript Gotchas

The tsconfig has several strict flags that go beyond `strict: true`.
These will cause errors if you don't know about them.

### `noPropertyAccessFromIndexSignature`

Cannot use dot notation on types with a `[key: string]: T` index signature.
Use bracket notation instead.

```typescript
// ERROR: flags["output-dir"] is fine; flags.source triggers this when flags
// has an index signature
const x = flags["source"];   // OK
const y = flags.source;      // OK only if flags has source as named property

// Zod z.looseObject() inferred types have an index signature - cast first:
const overrides = doc.frontmatter.tools?.aider as AiderOverrides | undefined;
```

### `noUncheckedIndexedAccess`

Array element access and destructuring returns `T | undefined`.

```typescript
const arr: string[] = ["a", "b"];
const x = arr[0];            // x: string | undefined
const [first] = arr;         // first: string | undefined

// Fix with type assertion when you know the element exists:
const [first] = arr as [string];
```

### `exactOptionalPropertyTypes`

Optional properties cannot be set to `undefined` - they must be omitted.

```typescript
interface Opts { dir?: string }

// ERROR: cannot pass undefined for an optional string
const opts: Opts = { dir: undefined };

// OK: omit the property conditionally
const opts: Opts = { ...(dir ? { dir } : {}) };
```

### Biome vs TypeScript: `Record<string, unknown>`

Biome's `useLiteralKeys` wants dot notation (`config.key`), but TypeScript's
`noPropertyAccessFromIndexSignature` requires bracket notation for
`Record<string, unknown>` properties.

**Resolution:** Use a typed interface with named properties instead of `Record<string, unknown>`.
Named properties use dot notation; only hyphenated keys (invalid identifiers) need bracket
notation.
See `AiderYamlConfig` in
[packages/adapters/aider/src/index.ts](packages/adapters/aider/src/index.ts).

---

## Definition of Done

A task is complete when all of the following are true:

- [ ] Unit tests written and passing (`pnpm run test:run`)
- [ ] Zero TypeScript errors (`pnpm run typecheck`)
- [ ] Zero lint errors (`pnpm run lint`)
- [ ] Golden-file tests added for any new adapter output
- [ ] Integration test added where behavior touches multiple packages

---

## Pull Request Process

1. Branch from `main`
1. Keep PRs focused - one logical change per PR
1. All CI checks must pass
1. PR description should state: what changed, why, and how to verify

Human reviews AI-generated PRs against acceptance criteria. Binary pass/fail - no partial merges.
