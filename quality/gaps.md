# Quality Gaps

This document tracks all open quality gaps identified in the baseline. Every gap must have an owner, target date, and status.

**Last updated:** 2026-03-06

## Open Gaps

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

---

### GAP-002: Config-Hub Low Branch Coverage

**Severity:** High
**Owner:** @otterammo
**Target Date:** 2026-03-27
**Status:** Open
**Baseline Metric:** `config-hub` package has 44.1% branch coverage

**Description:**
The config-hub package has insufficient branch coverage, indicating many edge cases and error paths are not tested.

**Action Items:**

- [ ] Identify untested branches via coverage report
- [ ] Add tests for error handling paths
- [ ] Add tests for edge cases in sync engine
- [ ] Achieve minimum 80% branch coverage

**Related Issues:** TBD

---

### GAP-003: Core Package Branch Coverage

**Severity:** Medium
**Owner:** @otterammo
**Target Date:** 2026-04-03
**Status:** Open
**Baseline Metric:** `core` package has 63.46% branch coverage

**Description:**
The core package has adequate line coverage but insufficient branch coverage, suggesting incomplete testing of conditional logic and error paths.

**Action Items:**

- [ ] Review coverage report for untested branches
- [ ] Add tests for validation error paths
- [ ] Add tests for edge cases in schema parsing
- [ ] Achieve minimum 80% branch coverage

**Related Issues:** TBD

---

### GAP-004: Config-Hub Line Coverage

**Severity:** Medium
**Owner:** @otterammo
**Target Date:** 2026-04-03
**Status:** Open
**Baseline Metric:** `config-hub` package has 57.49% line coverage

**Description:**
The config-hub package has low overall line coverage, indicating significant untested code paths.

**Action Items:**

- [ ] Identify untested modules
- [ ] Add tests for sync engine core logic
- [ ] Add tests for adapter orchestration
- [ ] Achieve minimum 80% line coverage

**Related Issues:** TBD

---

## Closed Gaps

_Closed gaps will be listed here with resolution details._

---

## Coverage Targets

All packages must meet the following minimum thresholds:

- **Lines:** 80%
- **Statements:** 80%
- **Functions:** 80%
- **Branches:** 80%

## Backlog

See [quality/backlog.md](backlog.md) for the weekly-updated quality improvement backlog.
