# Time-Bound Legacy Debt Budget (MIG-003)

**Requirement:** MIG-003 (Phase 1 of Quality Migration)

**Parent Spec:** Quality Baseline Migration Strategy

## Overview

The Time-Bound Legacy Debt Budget enforces accountability for quality gap remediation through mandatory owner assignment, target dates, and escalation of overdue items. This is a critical component of the quality migration strategy that ensures technical debt doesn't accumulate indefinitely.

## Acceptance Criteria

1. ✅ Each backlog item has `owner`, `severity`, `target_date`
1. ✅ Overdue items trigger escalation in weekly quality review

## Requirements

### Backlog Item Fields (QBASE-002)

Every quality gap entry in `quality/gaps.md` must include:

1. **Owner** (`owner`) - GitHub username of the person responsible for remediation
   - Format: `@username`
   - Required for all open gaps

1. **Severity** (`severity`) - Impact level of the quality gap
   - Values: `Critical`, `High`, `Medium`, or `Low`
   - Used for prioritization in escalation reports

1. **Target Date** (`target_date`) - ISO 8601 date when the gap should be closed
   - Format: `YYYY-MM-DD`
   - Must be a valid future or current date
   - Used to calculate overdue status

### Escalation Mechanism

Overdue items are automatically flagged in:

1. **Validation Script** (`quality:validate-gaps`)
   - Detects gaps with `target_date` < today
   - Reports overdue count in validation summary
   - Continues to pass validation (informational only)

1. **Weekly Quality Review** (`quality:review`)
   - Generates comprehensive escalation report
   - Groups gaps by severity and overdue status
   - Provides actionable recommendations
   - Saved to `.quality/review-YYYY-MM-DD.md`

## Implementation

### Scripts

#### `scripts/validate-quality-gaps.mjs`

Enhanced to detect and report overdue gaps:

```bash
pnpm run quality:validate-gaps
```

**Output:**

- Validates all required fields (owner, severity, target_date)
- Reports overdue gaps with days overdue
- Provides escalation guidance

**Exit Code:** Always 0 for valid fields (overdue is informational)

#### `scripts/quality-review.mjs`

Weekly quality review report generator:

```bash
pnpm run quality:review
```

**Output:**

- Markdown report saved to `.quality/review-YYYY-MM-DD.md`
- Categorizes gaps: Overdue, Due This Week, On Track
- Sorted by severity and days overdue
- Includes progress tracking and recommendations

**Exit Code:** Always 0 (reporting tool, not enforcement)

### Workflow

#### Daily Development

When creating or updating quality gaps:

1. Ensure all required fields are present:

   ```markdown
   **Severity:** Critical
   **Owner:** @username
   **Target Date:** 2026-03-20
   **Status:** Open
   ```

1. Run validation:

   ```bash
   pnpm run quality:validate-gaps
   ```

1. Check for overdue items and address them

#### Weekly Quality Review (Monday 9:00 AM)

1. Generate review report:

   ```bash
   pnpm run quality:review
   ```

1. Review escalated items in team meeting

1. For each overdue gap:
   - **Option A:** Update target date with justification
   - **Option B:** Close gap if resolved
   - **Option C:** Escalate to stakeholders if blocked

1. Update `quality/gaps.md` with decisions

1. Update `quality/backlog.md` with sprint priorities

## Overdue Gap Handling

### Detection

A gap is considered overdue when:

- `status !== "Closed"`
- `target_date < today` (midnight comparison)

### Escalation Priority

Overdue gaps are prioritized by:

1. **Severity** (Critical → High → Medium → Low)
1. **Days Overdue** (most overdue first within each severity)

### Resolution Options

For each overdue gap, choose one:

**1. Extend Target Date**

- Valid if legitimate blockers exist
- Update `target_date` field
- Add justification in gap description
- Document reason in PR

**2. Close Gap**

- Valid if work is complete
- Update `status: Closed`
- Add `Resolved By: #PR-number`
- Move to "Closed Gaps" section

**3. Escalate**

- Valid if external dependencies block progress
- Document blocker in gap description
- Escalate to appropriate stakeholders
- Keep in weekly review until resolved

## Example Gap Entry

```markdown
### GAP-001: CLI Package Zero Coverage

**Severity:** Critical
**Owner:** @otterammo
**Target Date:** 2026-03-20
**Status:** Open
**Baseline Metric:** `cli` package has 0% coverage across all categories

**Description:**
The CLI package currently has no test coverage. This is a critical gap as the CLI is the primary entry point for users.

**Action Items:**
- [ ] Add unit tests for command parsing
- [ ] Add integration tests for sync command
- [ ] Add integration tests for validate command
- [ ] Achieve minimum 80% line coverage

**Related Issues:** TBD
```

## Weekly Review Report Format

The `quality:review` script generates a structured report:

```markdown
# Weekly Quality Review Report

**Report Date:** 2026-03-07

## Summary
- **Total Open Gaps:** 4
- **Overdue:** 2 🔴
- **Due This Week:** 1 ⚠️
- **On Track:** 1 ✅

## 🚨 OVERDUE GAPS - ESCALATION REQUIRED (MIG-003)

### GAP-001: Critical Gap Title
- **Severity:** Critical 🔴
- **Owner:** @username
- **Target Date:** 2026-02-28
- **Days Overdue:** 7
- **Status:** Open

**Required Actions:**
- [ ] Review with @username for status update
- [ ] Extend target date with justification, OR
- [ ] Close gap if resolved, OR
- [ ] Escalate to stakeholders if blocked

...
```

## Integration with Quality Baseline

MIG-003 builds on the quality baseline infrastructure:

- **MIG-001:** Baseline Lock Before Enforcement
  - Establishes initial quality snapshot
  - All gaps reference baseline metrics

- **MIG-002:** No-New-Debt Rule in Phase 1
  - Prevents new violations from entering
  - Existing debt tracked in `quality/gaps.md`

- **MIG-003:** Time-Bound Legacy Debt Budget (this document)
  - Ensures existing debt has owners and deadlines
  - Escalates overdue items for accountability

- **MIG-004:** Package Hardening Contract
  - Defines graduation criteria for packages
  - Uses gap tracking to verify readiness

## Automation

### CI Integration

Currently informational only - not blocking CI:

```yaml
# Future: Add to .github/workflows/ci.yml
quality-review:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: pnpm run quality:review
    - uses: actions/upload-artifact@v4
      with:
        name: quality-review-report
        path: .quality/review-*.md
```

### Scheduled Reporting

Future enhancement: Automated weekly reports via GitHub Actions scheduled workflow.

## Metrics

Track over time:

- Number of overdue gaps by severity
- Average days overdue
- Gap closure rate
- Target date extension frequency

## References

- **QBASE-002:** Quality Gap Ownership Tracking (see [quality-gap-tracking.md](quality-gap-tracking.md))
- **MIG-002:** No-New-Debt Rule (see [no-new-debt-rule.md](no-new-debt-rule.md))
- **Issue #266:** MIG-003 implementation tracking
- **quality/gaps.md:** Open and closed quality gaps
- **quality/backlog.md:** Weekly sprint planning
