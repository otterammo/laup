# Markdown and Machine-Readable Style Guide

## 1. Purpose and Scope

This guide defines strict, blocking style and lint requirements for:

- Markdown and MDC (`*.md`, `*.mdc`)
- YAML (`*.yml`, `*.yaml`)
- JSON/JSONC (`*.json`, `*.jsonc`)

The goals are deterministic formatting, stable diffs, and reliable machine parsing across
canonical instructions, generated artifacts, and CI workflows.

## 2. Markdown Rules

Markdown is enforced via `markdownlint-cli2` with repository configuration in
`.markdownlint-cli2.yaml`.

Required rule baseline:

- `MD001`: heading increment
- `MD003`: ATX heading style
- `MD004`: unordered list marker is `-`
- `MD007`: unordered list indent is 2 spaces
- `MD009`: no trailing spaces
- `MD010`: no tabs
- `MD012`: no multiple consecutive blank lines
- `MD013`: disabled (no hard line-length enforcement; avoid artificial hard wraps)
- `MD022`: blank lines around headings
- `MD024`: duplicate headings allowed only in separate sections
- `MD025`: single top-level heading
- `MD029`: ordered list numbering style `1. 2. 3.`
- `MD030`: consistent list marker spacing
- `MD031`: fenced code blocks surrounded by blank lines
- `MD032`: lists surrounded by blank lines
- `MD034`: no bare URLs in prose
- `MD040`: fenced code blocks require an explicit language
- `MD046`: fenced code block style
- `MD047`: file ends with one newline
- `MD048`: backtick fence style

Generated golden markdown files are linted with the same baseline, but `MD041` is disabled
for those files because they intentionally begin with generated preamble/comments.

Write prose naturally. Do not insert manual line breaks solely to satisfy a line-length target.

## 3. Markdown Frontmatter Rules (`.md` and `.mdc`)

Frontmatter is validated by `scripts/lint-frontmatter.mjs`.

When a file starts with frontmatter (`---` at first line), enforcement is:

1. Frontmatter must close with `---` or `...`.
1. YAML must parse successfully.
1. Duplicate keys are disallowed.
1. Tabs and trailing whitespace are disallowed in frontmatter lines.
1. For LAUP canonical frontmatter keys, order must be:
   `version`, `scope`, `metadata`, `tools`, `permissions`.

Failures print `file:line:column` diagnostics and fail lint.

## 4. YAML Rules (`.yml`, `.yaml`)

YAML is validated by `scripts/lint-yaml.mjs`.

Requirements:

1. YAML parses successfully.
1. Duplicate keys are disallowed.
1. Tabs are disallowed.
1. Trailing whitespace is disallowed.
1. Files must end with a newline.

`pnpm-lock.yaml` is excluded as a generated artifact.

## 5. JSON / JSONC Rules

JSON and JSONC are validated by Biome (`biome check .`).

Requirements are inherited from `biome.json`, including formatting and lint rules. Any
machine-readable config edits must keep `pnpm run lint` passing.

## 6. Generated Files Policy

Generated artifacts are still linted unless explicitly excluded for a narrow, documented
reason.

Current explicit exception:

- Golden markdown fixtures under `packages/**/src/__tests__/golden/*.md` disable `MD041`
  only, because generated headers intentionally appear before the first heading.

No broad file-level disable is allowed for authored docs.

## 7. Local and CI Enforcement Commands

Run from repository root:

```bash
pnpm run lint          # markdown + machine-readable + biome
pnpm run lint:fix      # safe autofix where available
pnpm run lint:md       # markdown-only checks
pnpm run lint:machine  # yaml + frontmatter + biome
pnpm run lint:yaml     # yaml-only checks
pnpm run lint:frontmatter
```

Pre-commit (`lint-staged`) enforces changed files for code, markdown, and YAML.

CI enforces blocking `pnpm run lint` before typecheck and tests.

## 8. Exception Process

If a rule must be scoped out:

1. Prefer the narrowest possible scope (single file or glob).
1. Document the reason in the config and in the PR description.
1. Do not disable unrelated rules.
1. Keep generated-file exceptions minimal and explicit.

Any permanent exception should be reviewed as a standards decision, not treated as a
one-off convenience.
