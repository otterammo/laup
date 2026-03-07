# Lint Warning Validation Tests (CIG-002)

This directory contains tests for the lint warning allowlist validation system.

## Purpose

These tests verify that the `scripts/validate-lint-warnings.mjs` script correctly:

1. Validates empty allowlists (no exceptions)
1. Accepts properly formatted exception entries
1. Rejects entries missing required fields
1. Detects and rejects expired exceptions
1. Enforces format rules for all fields
1. Limits exception duration to 90 days

## Related Documentation

- [Lint Strict Mode (CIG-002)](../../docs/lint-strict-mode.md)
- [Challenge Question Q-004](../../quality/challenge-questions.md)

## Running Tests

```bash
# Run all lint warning tests
pnpm run test tests/lint-warnings

# Run with coverage
pnpm run test:run --coverage tests/lint-warnings
```

## Test Structure

### validate-lint-warnings.test.ts

Tests the validation script with various allowlist configurations:

- **Empty allowlist**: Should pass
- **Valid entry**: Should pass
- **Missing fields**: Should fail
- **Expired exception**: Should fail
- **Invalid formats**: Should fail for each field type
- **Exceeds duration limit**: Should fail

Each test:

1. Backs up the existing allowlist
1. Creates a temporary allowlist with test data
1. Runs the validation script
1. Verifies the expected outcome
1. Restores the original allowlist

## CI Integration

The validation script runs in the `quality/lint` job before running the actual lint checks. This ensures:

1. All exceptions are properly documented
1. No exceptions have expired
1. All format requirements are met

If validation fails, the CI build fails before running lint.
