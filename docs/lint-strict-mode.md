# CIG-002: Lint Must Hard-Fail on Strict Diagnostics

**Status:** Implemented  
**Related Issues:** #256  
**Implementation:** `scripts/validate-lint-warnings.mjs`

## Overview

This requirement ensures that all lint warnings from Biome are treated as blocking
errors unless explicitly allowed through a centrally-tracked allowlist with expiry dates.

## Requirements

1. **Strict Warning Escalation**: Biome lint step uses `--error-on-warnings` flag
1. **Exit Code Enforcement**: Lint exits with non-zero code when strict warnings exist
1. **Central Exception Tracking**: Migration exceptions are tracked in `.lint-warnings-allowlist.json`
   with mandatory expiry dates and approval

## Implementation

### Biome Configuration

The `biome.json` configuration includes:

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

### Package Scripts

- `lint:biome`: Runs `biome check . --error-on-warnings`
- `quality:validate-lint-warnings`: Runs the validation script

### Validation Script

The `scripts/validate-lint-warnings.mjs` script:

1. Loads `.lint-warnings-allowlist.json`
1. Validates each entry's structure and required fields
1. Checks that all file paths are relative (not absolute)
1. Validates rule format is `category/ruleName`
1. Ensures justifications are meaningful (min 10 characters)
1. Verifies approver format (@username)
1. Checks tracking issue format (#123)
1. Validates that expiry dates haven't passed
1. Ensures exception duration doesn't exceed 90 days
1. Exits with code 1 if any validation fails

### CI Integration

The CI workflow (`.github/workflows/ci.yml`) includes:

```yaml
- name: Validate lint warnings allowlist (CIG-002)
  run: pnpm run quality:validate-lint-warnings
- name: Run lint
  run: pnpm run lint
```

This ensures that:

1. Allowlist structure is validated first
1. All entries have required fields and proper format
1. No exceptions have expired
1. Then full lint runs with `--error-on-warnings`
1. Any structural or expiry issues cause CI to fail

## Allowlist Format

File: `.lint-warnings-allowlist.json`

```json
[
  {
    "file": "packages/core/src/example.ts",
    "rule": "suspicious/noExplicitAny",
    "justification": "Legacy code from migration, tracked for refactor in Q2 2026",
    "approver": "@otterammo",
    "approvalDate": "2026-03-06",
    "expiryDate": "2026-06-01",
    "trackingIssue": "#123"
  }
]
```

### Required Fields

- **file**: Relative file path from repo root (must be relative, not absolute)
- **rule**: Biome rule name in format `category/ruleName` (e.g., `suspicious/noExplicitAny`)
- **justification**: Detailed explanation (minimum 10 characters) of why this exception exists
- **approver**: GitHub username with @ prefix (e.g., `@otterammo`)
- **approvalDate**: ISO date when exception was approved (YYYY-MM-DD)
- **expiryDate**: ISO date by which this must be fixed (YYYY-MM-DD)
- **trackingIssue**: GitHub issue reference in format `#123`

### Validation Rules

- **File paths** must be relative from repo root
- **Rule format** must be `category/ruleName`
- **Justification** must be at least 10 characters
- **Approver** must start with `@`
- **Tracking issue** must be in format `#123`
- **Exception duration** cannot exceed 90 days (from approval to expiry)
- **Expired exceptions** are treated as violations and fail CI

### Expiry Policy

- All exceptions **must** have an expiry date
- Maximum exception period: **90 days**
- Expired exceptions cause CI to fail
- Use shorter periods for high-priority items

## Usage

### Checking Warnings

```bash
# Run validation only
pnpm run quality:validate-lint-warnings

# Run full lint (includes validation)
pnpm run lint
```

### Adding an Exception

1. Identify the warning from lint output
1. Create a GitHub issue to track the resolution
1. Get approval from a maintainer (record their GitHub username)
1. Add entry to `.lint-warnings-allowlist.json`:

```json
{
  "file": "packages/core/src/example.ts",
  "rule": "correctness/noUnusedVariables",
  "justification": "Temporary workaround for API migration to new provider interface",
  "approver": "@maintainer-username",
  "approvalDate": "2026-03-06",
  "expiryDate": "2026-06-01",
  "trackingIssue": "#256"
}
```

1. Ensure expiry date is within 90 days of approval date
1. Commit with issue reference in commit message

### Removing an Exception

When the underlying issue is fixed:

1. Fix the code to eliminate the warning
1. Remove the entry from `.lint-warnings-allowlist.json`
1. Close the tracking issue
1. Verify with `pnpm run lint`

## Philosophy

- **Warnings are errors in disguise**: If Biome flags it, it should be fixed
- **Exceptions are temporary**: Every exception must have a deadline (max 90 days)
- **Visibility is critical**: All exceptions are centrally tracked and require approval
- **Migration support**: Allowlist enables gradual migration without blocking progress

## Best Practices

1. **Fix first, allowlist last**: Prefer fixing warnings over adding exceptions
1. **Short expiry dates**: Keep pressure on to resolve issues (max 90 days)
1. **Specific entries**: One entry per file/rule combination
1. **Update regularly**: Review allowlist monthly, remove resolved items
1. **Link to issues**: Always reference a GitHub issue for tracking
1. **Get approval**: All exceptions must have an approver recorded
1. **Meaningful justifications**: Explain why the exception is needed (min 10 chars)

## Related

- **CIG-001**: Explicit PR Blocking Gate Set (branch protection) - #255
- **LGR-004**: Skip/Only Test Guard (similar pattern for test modifiers)
- **Q-004**: Lint Warning Allowlist Challenge Question
- **DOC-620**: Quality Gates Implementation Guide (parent spec)
