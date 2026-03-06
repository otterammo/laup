# Lint Strict Mode (CIG-002)

## Overview

CIG-002 enforces strict lint checking where all warnings are treated as blocking errors in CI. This ensures consistent code quality and prevents warning accumulation over time.

## Requirements

From challenge question Q-004:

> All lint warnings are treated as blocking errors in CI (LGR-003, CIG-002). The `lint:fix` command should resolve most warnings automatically. Any warnings that cannot be auto-fixed must be addressed manually before PR approval. No lint rule exceptions are allowed without documented justification and approver sign-off in the exception config.

## Implementation

### 1. Biome Configuration

The `biome.json` configuration enforces strict rules with recommended defaults plus custom overrides. The `lint:biome` script uses `--error-on-warnings` to ensure warnings exit non-zero.

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      }
    }
  }
}
```

### 2. CI Integration

The CI workflow runs `pnpm run lint` which includes:

```bash
pnpm run lint:machine  # Includes lint:biome with --error-on-warnings
```

When strict warnings exist, biome exits with non-zero status and fails the CI build.

### 3. Migration Exception Tracking

During migration to strict mode, temporary exceptions can be documented in `.lint-warnings-allowlist.json`:

```json
[
  {
    "file": "packages/core/src/legacy-module.ts",
    "rule": "suspicious/noExplicitAny",
    "justification": "Legacy API requires dynamic typing",
    "approver": "@otterammo",
    "approvalDate": "2026-03-06",
    "expiryDate": "2026-06-06",
    "trackingIssue": "#300"
  }
]
```

**Schema:**

- `file` (string, required): Relative path from repo root
- `rule` (string, required): Biome rule identifier (e.g., `suspicious/noExplicitAny`)
- `justification` (string, required): Why this exception is needed
- `approver` (string, required): GitHub handle of approver
- `approvalDate` (string, required): ISO 8601 date when approved
- `expiryDate` (string, required): ISO 8601 date when exception expires
- `trackingIssue` (string, optional): GitHub issue tracking remediation

### 4. Validation

The script `scripts/validate-lint-warnings.mjs` runs in CI to:

1. Load `.lint-warnings-allowlist.json`
1. Verify all fields are present and valid
1. Check no exceptions have expired
1. Ensure tracking issues exist for each exception
1. Fail the build if validation fails

Run validation:

```bash
pnpm run quality:validate-lint-warnings
```

### 5. Local Workflow

**Before committing:**

```bash
# Auto-fix what can be fixed
pnpm run lint:fix

# Check for remaining warnings
pnpm run lint
```

**If warnings remain:**

1. Fix the warning manually, OR
1. Document an exception in `.lint-warnings-allowlist.json`:
   - Get approval from a maintainer
   - Set expiry date (max 90 days from approval)
   - Create a tracking issue
   - Add entry to allowlist

**Pre-commit hook** validates that committed code has no undocumented warnings.

## Progression

**Current State (Phase 2):**

- Biome runs with `--error-on-warnings`
- Allowlist exists but may contain entries
- CI checks are enforcing but allow temporary exceptions

**Phase 3 (Hard-Gate):**

- `.lint-warnings-allowlist.json` should be empty or near-empty
- All exceptions must have valid expiry dates
- No new exceptions allowed without executive approval
- CI fails immediately on undocumented warnings

## Exception Policy

### When to Request an Exception

Exceptions should be **rare** and only for:

- **Legacy code** being migrated (temporary, max 90 days)
- **External API constraints** that force non-ideal patterns
- **Generated code** that cannot be easily modified
- **Deprecated code** scheduled for removal

### When NOT to Request an Exception

- **Convenience** ("it's easier to ignore this")
- **Time pressure** ("we'll fix it later")
- **Preference** ("I don't like this rule")
- **Lack of understanding** ("I don't know why this is a warning")

### Approval Process

1. Add entry to `.lint-warnings-allowlist.json` with all required fields
1. Create PR with the exception
1. Tag a maintainer for review and approval
1. Maintainer validates justification and approves
1. Exception is time-bound and must be resolved before expiry

### Expiry Handling

When an exception expires:

1. `validate-lint-warnings.mjs` fails in CI
1. The warning must be fixed OR
1. A new exception must be requested with fresh justification
1. Expiry extensions require executive approval

## Integration with Other Quality Gates

CIG-002 works alongside:

- **LGR-003:** Pre-commit staged-file lint checking
- **LGR-004:** Skip/only test guard
- **CIG-003:** Coverage thresholds
- **CIG-004:** Test hermeticity

Together, these gates ensure high code quality throughout the development lifecycle.

## References

- **DOC-620:** Coverage threshold and quality gates overview
- **Q-004:** Challenge question on lint warning treatment
- **Issue #256:** CIG-002 implementation tracking
- **LGR-003:** Local gate for lint warnings on staged files
