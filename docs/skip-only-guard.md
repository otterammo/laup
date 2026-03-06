# Skip/Only Test Guard (LGR-004)

**Status:** ✅ Implemented
**Issue:** #250
**Policy Reference:** Q-005 in quality/challenge-questions.md

## Overview

The Skip/Only Test Guard prevents `.skip` and `.only` test modifiers from being committed to the main branch. This ensures test isolation and prevents accidentally disabling tests or running only a subset of tests in CI.

## Policy

As defined in Q-005:

- `.only` and `.skip` modifiers are **never allowed** in code committed to `main`
- Pre-commit hooks and CI checks (LGR-004, CIG-008) detect and block these markers
- For temporary skips during refactoring, tests must be moved to a dedicated `__tests__/quarantine/` directory with a tracking issue in the skip reason comment
- Quarantined tests must be resolved within 14 days or the feature must be removed

## Implementation

### Validation Script

`scripts/validate-skip-only.mjs` scans test files for skip/only markers:

- `it.only()`, `it.skip()`
- `test.only()`, `test.skip()`
- `describe.only()`, `describe.skip()`
- `test.each.only()`, `describe.each.only()`

The script is automatically run via `lint-staged` on pre-commit for any changed test files.

### Allowlist

In exceptional cases (e.g., gradual migration, temporary blockers), markers can be temporarily allowed via `.skip-only-allowlist.json`:

```json
[
  {
    "path": "packages/core/src/__tests__/broken-test.test.ts",
    "issueId": "#250",
    "expiryDate": "2026-03-20",
    "reason": "Temporary skip during refactoring of authentication system"
  }
]
```

**Required fields:**

- `path` - Full path to the test file (relative to repo root)
- `issueId` - GitHub issue tracking the remediation work
- `expiryDate` - ISO 8601 date (YYYY-MM-DD) when the allowlist entry expires (max 14 days)
- `reason` - Human-readable explanation for why the skip/only is needed

**Validation rules:**

1. All allowlist entries must have `issueId` and `expiryDate`
1. Expired entries fail validation (treated as violations)
1. Invalid date formats fail validation
1. Allowlist file is version-controlled and reviewed in PRs

## Usage

### Manual Validation

```bash
# Check all test files
node scripts/validate-skip-only.mjs packages/**/__tests__/**/*.test.ts

# Check specific files
node scripts/validate-skip-only.mjs packages/core/src/__tests__/example.test.ts
```

### Pre-commit Hook

The validator runs automatically via `lint-staged` when you commit changes to test files:

```bash
git add packages/core/src/__tests__/example.test.ts
git commit -m "feat(core): add new test"
# If skip/only markers are detected, commit is blocked
```

### CI Integration

Add to `.github/workflows/ci.yml`:

```yaml
- name: Validate skip/only markers
  run: |
    git diff --name-only --diff-filter=ACM origin/main... \
      | grep -E '\.(test|spec)\.(ts|js)$|__tests__' \
      | xargs -r node scripts/validate-skip-only.mjs
```

## Remediation Options

When the validator detects violations, you have three options:

### 1. Remove the marker and fix the test (recommended)

```typescript
// Before
it.skip("should handle edge case", () => {
 // test code
});

// After - fix the test
it("should handle edge case", () => {
 // fixed test code
});
```

### 2. Move to quarantine with tracking issue

```bash
mkdir -p packages/core/src/__tests__/quarantine/
git mv packages/core/src/__tests__/broken-test.test.ts \
     packages/core/src/__tests__/quarantine/
```

Update the test file to include tracking issue:

```typescript
// Quarantined: #250 - Refactoring authentication system
// Target resolution: 2026-03-20
describe.skip("authentication edge cases", () => {
 // ...
});
```

### 3. Add to allowlist (use sparingly)

Update `.skip-only-allowlist.json`:

```json
[
 {
  "path": "packages/core/src/__tests__/problematic.test.ts",
  "issueId": "#250",
  "expiryDate": "2026-03-20",
  "reason": "Temporary skip during authentication refactor"
 }
]
```

**Important:** Allowlist entries expire automatically. Plan to fix the test before expiry.

## Testing

The validator itself is tested in `tests/scripts/validate-skip-only.test.ts`:

```bash
pnpm run test:run tests/scripts/validate-skip-only.test.ts
```

Test coverage includes:

- Detection of all skip/only variants
- Allowlist validation (valid entries, expiry, missing fields)
- Non-test file filtering
- Error messaging

## Related Documentation

- [Quality Gap Tracking](quality-gap-tracking.md) - QBASE-002 ownership tracking
- [Challenge Questions](../quality/challenge-questions.md) - Q-005 skip/only policy
- [Quality Baseline](quality-baseline.md) - QBASE-001 versioned metrics

## References

- **Issue:** #250
- **Requirement:** LGR-004 from DOC-610 (wiki)
- **Policy:** Q-005 in quality/challenge-questions.md
- **Related:** CIG-008 (CI skip/only guard)
