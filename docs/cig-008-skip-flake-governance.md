# Skip/Flake Governance (CIG-008)

**Status:** ✅ Implemented
**Issue:** #262
**Parent Spec:** DOC-620 (CI Merge Gates)
**Related:** LGR-004 (pre-commit skip/only guard)

## Overview

CIG-008 enforces skip and flaky test governance in CI to prevent test quality degradation. This is the CI-level enforcement that complements LGR-004 (pre-commit hooks).

## Acceptance Criteria

### AC1: New Skipped Tests Fail CI Unless Linked

New skipped tests (`.skip` markers) must fail CI unless:

- Linked to a GitHub issue via `.skip-only-allowlist.json`
- Has an expiry date (max 14 days from current date)
- Includes a reason explaining why the skip is necessary

### AC2: Flaky Tests Are Quarantined with Metadata

Flaky tests (tests that fail intermittently) must be:

- Moved to `__tests__/quarantine/` directory
- Tagged with owner, target fix date, and tracking issue
- Monitored for resolution within 14 days
- Removed from regular test runs to prevent CI noise

### AC3: Dashboard Exposes Skip and Flaky Counts Over Time

A dashboard must track and report:

- Current count of skipped tests (with and without allowlist)
- Current count of quarantined flaky tests
- Historical trends (skip/flake counts over time)
- Owner assignments and expiry dates
- Violations (expired allowlist entries, overdue quarantines)

## Implementation

### 1. CI Skip/Only Validation

**Script:** `scripts/validate-skip-only-ci.mjs`

Validates all test files in the repository (not just changed files):

```bash
node scripts/validate-skip-only-ci.mjs
```

This is stricter than LGR-004 because:

- LGR-004 (pre-commit): Only checks changed files
- CIG-008 (CI): Checks all files to catch allowlist expiry

**Exit codes:**

- `0` - No violations
- `1` - Violations found (skip/only without allowlist or expired allowlist)

**Integration:** `.github/workflows/ci.yml` job `quality/skip-flake`

### 2. Flaky Test Detection

**Script:** `scripts/detect-flaky-tests.mjs`

Analyzes test run history to detect flaky tests:

```bash
node scripts/detect-flaky-tests.mjs [--runs N]
```

**Detection criteria:**

- Test fails at least once
- Test passes at least once
- Within the last N runs (default: 10)

**Output:** List of flaky test file paths

### 3. Quarantine Mechanism

**Directory structure:**

```text
packages/[package]/src/__tests__/quarantine/
  ├── flaky-auth.test.ts
  ├── flaky-validation.test.ts
  └── .quarantine-manifest.json
```

**Manifest format (`.quarantine-manifest.json`):**

```json
{
  "version": "1.0",
  "tests": [
    {
      "path": "flaky-auth.test.ts",
      "issueId": "#262",
      "owner": "@otterammo",
      "quarantinedAt": "2026-03-07",
      "targetFixDate": "2026-03-21",
      "reason": "Intermittent timeout in CI environment",
      "flakyRuns": ["run-123", "run-456"]
    }
  ]
}
```

**Validation:** `scripts/validate-quarantine.mjs`

- Checks that all quarantined tests have valid manifest entries
- Fails CI if tests are overdue (past `targetFixDate`)
- Warns on tests approaching deadline

### 4. Skip/Flake Dashboard

**Script:** `scripts/generate-skip-flake-report.mjs`

Generates metrics and dashboard data:

```bash
node scripts/generate-skip-flake-report.mjs [--output report.json]
```

**Output format:**

```json
{
  "timestamp": "2026-03-07T01:32:00Z",
  "summary": {
    "totalSkipped": 5,
    "skippedWithAllowlist": 3,
    "skippedWithoutAllowlist": 0,
    "expiredAllowlist": 2,
    "totalQuarantined": 2,
    "quarantinedOverdue": 0
  },
  "skippedTests": [
    {
      "path": "packages/core/src/__tests__/example.test.ts",
      "issueId": "#250",
      "expiryDate": "2026-03-20",
      "daysUntilExpiry": 13,
      "status": "valid"
    }
  ],
  "quarantinedTests": [
    {
      "path": "packages/core/src/__tests__/quarantine/flaky-auth.test.ts",
      "issueId": "#262",
      "owner": "@otterammo",
      "targetFixDate": "2026-03-21",
      "daysUntilDeadline": 14,
      "status": "active"
    }
  ],
  "violations": []
}
```

**Historical tracking:** Reports are versioned and stored in `quality/skip-flake-history/`

### 5. CI Integration

**Workflow:** `.github/workflows/ci.yml`

```yaml
skip_flake_governance:
  name: quality/skip-flake
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
      with:
        fetch-depth: 0  # Fetch full history for trend analysis
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v6
      with:
        node-version: "22"
        cache: "pnpm"
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Validate skip/only markers (CIG-008)
      run: node scripts/validate-skip-only-ci.mjs
    - name: Validate quarantine manifest (CIG-008)
      run: node scripts/validate-quarantine.mjs
    - name: Generate skip/flake report (CIG-008)
      run: node scripts/generate-skip-flake-report.mjs --output quality/skip-flake-latest.json
    - name: Upload report artifact
      uses: actions/upload-artifact@v4
      with:
        name: skip-flake-report
        path: quality/skip-flake-latest.json
```

## Usage Workflows

### Developer: I need to skip a test temporarily

**Option 1: Add to allowlist (max 14 days)**

1. Create or update `.skip-only-allowlist.json`:

```json
[
  {
    "path": "packages/core/src/__tests__/problematic.test.ts",
    "issueId": "#262",
    "expiryDate": "2026-03-21",
    "reason": "Temporary skip during auth refactor"
  }
]
```

1. Commit and push - CI will allow the skip until expiry date

**Option 2: Move to quarantine (for flaky tests)**

1. Move test file:

```bash
mkdir -p packages/core/src/__tests__/quarantine/
git mv packages/core/src/__tests__/flaky-test.test.ts \
     packages/core/src/__tests__/quarantine/
```

1. Update quarantine manifest:

```json
{
  "version": "1.0",
  "tests": [
    {
      "path": "flaky-test.test.ts",
      "issueId": "#262",
      "owner": "@otterammo",
      "quarantinedAt": "2026-03-07",
      "targetFixDate": "2026-03-21",
      "reason": "Fails intermittently in CI"
    }
  ]
}
```

1. Commit and push

### Maintainer: Review skip/flake status

```bash
# Generate current report
node scripts/generate-skip-flake-report.mjs

# Check for violations
node scripts/validate-skip-only-ci.mjs
node scripts/validate-quarantine.mjs

# Detect new flaky tests
node scripts/detect-flaky-tests.mjs --runs 20
```

### CI: Automatic enforcement

CI automatically:

- Validates skip/only allowlist on every push
- Checks quarantine manifest validity
- Generates and uploads skip/flake reports
- Fails builds with violations

## Monitoring & Alerting

### Metrics Tracked

1. **Skip metrics:**
   - Total skipped tests
   - Skipped with valid allowlist
   - Expired allowlist entries
   - Days until expiry (warn at <3 days)

1. **Flake metrics:**
   - Total quarantined tests
   - Overdue quarantines
   - Average time in quarantine
   - Flake resolution rate

1. **Trends:**
   - Skip count over time
   - Flake count over time
   - Resolution velocity

### Dashboard Integration

Reports can be integrated with:

- GitHub Actions artifacts (automatic)
- Pull request comments (via workflow)
- External dashboards (export JSON)
- Slack/email notifications (on violations)

## Testing

Comprehensive tests cover:

- Skip/only validation (all variants)
- Allowlist validation (valid, expired, missing fields)
- Quarantine manifest validation
- Flaky test detection
- Report generation
- Historical trend tracking

**Run tests:**

```bash
pnpm run test:run tests/scripts/validate-skip-only-ci.test.ts
pnpm run test:run tests/scripts/validate-quarantine.test.ts
pnpm run test:run tests/scripts/generate-skip-flake-report.test.ts
```

## Related Documentation

- [Skip/Only Guard (LGR-004)](skip-only-guard.md) - Pre-commit hook implementation
- [Quality Gap Tracking](quality-gap-tracking.md) - QBASE-002 ownership
- [Challenge Questions](../quality/challenge-questions.md) - Q-005 policy
- [Coverage Threshold](coverage-threshold.md) - CIG-003 coverage gates

## References

- **Issue:** #262
- **Requirement:** CIG-008 from DOC-620 (wiki)
- **Policy:** Q-005 in quality/challenge-questions.md
- **Related:** LGR-004 (pre-commit), QBASE-002 (gap tracking)
