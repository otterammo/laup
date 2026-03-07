# Versioned Quality Baseline

Run `pnpm run quality:baseline` to generate a deterministic snapshot at
`quality/baseline.v1.json`.

The baseline contains:

- `schemaVersion`
- `commitSha`
- `generationTimestamp` (commit timestamp in ISO 8601)
- `lintDiagnosticsBySeverity` (`error`, `warning`, `info`)
- `skippedTests`
- `flakyTests`
- `coverageByPackage` (`lines`, `statements`, `functions`, `branches`)

## Committed Baseline

The current quality baseline is committed to the repository and can be viewed at:

**[quality/baseline.v1.json](../quality/baseline.v1.json)**

This baseline is locked as part of MIG-001 (Baseline Lock Before Enforcement) and serves as the reference point for quality metrics tracking and enforcement.

## Determinism

For the same repository content and commit SHA, baseline output is stable:

- SHA and timestamp are sourced from `git` metadata.
- Coverage is aggregated and output in sorted package order.
- Output format is stable, pretty-printed JSON.
