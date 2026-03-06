# Challenge Questions for Hard-Gate Rollout

This document tracks challenge questions that must be answered and approved before enabling hard-gate quality enforcement in CI (Phase 3 progression).

**Requirement:** QBASE-003

**Last updated:** 2026-03-06

## Schema

Each challenge question entry must include:

- **ID:** Unique identifier (e.g., `Q-001`)
- **Question:** The question that needs to be answered
- **Context:** Why this question matters for the hard-gate rollout
- **Answer:** The documented answer (required for Phase 3 progression)
- **Approver:** GitHub handle of the person who approved the answer (required for Phase 3 progression)
- **Approval Date:** ISO 8601 date when the answer was approved (required for Phase 3 progression)

## Validation

Run `pnpm run quality:validate-questions` to verify all questions have been answered and approved.

Unanswered or unapproved questions will block progression to Phase 3.

## Challenge Questions

### Q-001: Coverage Threshold Strategy

- **Question:** Should we enforce different coverage thresholds per package, or use a uniform threshold across all packages?
- **Context:** Current coverage varies widely (CLI at 0%, adapters at 86-96%, core at 63-80%). A uniform threshold may be too strict for some packages or too lenient for others.
- **Answer:** We will implement per-package thresholds based on current baseline with progressive improvement targets. Each package must maintain or improve its current coverage percentage, with a floor of 60% line coverage for any package with non-zero coverage. New packages must start at 80% minimum.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

### Q-002: Test Flake Tolerance

- **Question:** What is the acceptable threshold for flaky tests before blocking a release or PR merge?
- **Context:** Test flakiness can indicate timing issues, environment dependencies, or insufficient test isolation. Zero tolerance may be too strict initially, but some tolerance is needed for gradual improvement.
- **Answer:** Zero tolerance for new flaky tests. Existing flaky tests must be fixed or marked as skipped with a tracking issue within 2 weeks. Any test that fails intermittently more than once in a 7-day period is considered flaky and must be addressed before the next release.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

### Q-003: Legacy Debt Budget

- **Question:** How much existing technical debt should we allow to persist after hard-gate rollout, and what's the burn-down schedule?
- **Context:** Current baseline shows gaps in coverage and potential lint issues. Need to balance immediate quality enforcement with practical migration path.
- **Answer:** All quality gaps documented in quality/gaps.md must have owners, target dates, and be tracked to closure. No new debt is allowed after hard-gate rollout (MIG-002). Existing debt must be resolved within 3 months of rollout, with weekly progress updates. Any gap not resolved within the time-bound budget requires executive approval to extend or accept as permanent exception.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

### Q-004: Lint Warning Treatment

- **Question:** Should lint warnings be treated as blocking errors in CI, or remain as warnings?
- **Context:** Current baseline shows 0 warnings, but future changes may introduce warnings. Treating warnings as blocking ensures high code quality but may slow development velocity.
- **Answer:** All lint warnings are treated as blocking errors in CI (LGR-003, CIG-002). The `lint:fix` command should resolve most warnings automatically. Any warnings that cannot be auto-fixed must be addressed manually before PR approval. No lint rule exceptions are allowed without documented justification and approver sign-off in the exception config.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

### Q-005: Skip/Only Test Governance

- **Question:** Under what conditions are `.skip` and `.only` test modifiers allowed in committed code?
- **Context:** These modifiers are useful during development but can hide failures in CI. Need clear policy for when they're acceptable.
- **Answer:** `.only` and `.skip` modifiers are never allowed in code committed to `main`. Pre-commit hooks and CI checks (LGR-004, CIG-008) must detect and block these. For temporary skips during refactoring, tests must be moved to a dedicated `__tests__/quarantine/` directory with a tracking issue in the skip reason comment. Quarantined tests must be resolved within 14 days or the feature must be removed.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

### Q-006: Documentation Drift Detection

- **Question:** How do we ensure documentation stays synchronized with code changes?
- **Context:** Stale documentation is worse than no documentation. Need automated checks where possible and review processes where automation isn't feasible.
- **Answer:** Documentation drift is detected through multiple mechanisms: (1) CLI help output must match README command examples (LGR-006), (2) TypeScript interfaces must be documented with TSDoc, (3) All public APIs require examples in adjacent `.example.md` files, (4) Docs are linted and validated in CI. PR reviews must verify documentation updates for any public API changes. Documentation coverage is tracked in quality baseline starting Phase 2.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06

---

## Progression Criteria (QBASE-003)

**Phase 3 is blocked until:**

- [x] All challenge questions have documented answers
- [x] All challenge question answers have approver sign-off
- [x] All challenge question answers have approval dates

✅ **Status:** All challenge questions resolved. Phase 3 progression is ALLOWED.

## Review Schedule

This document must be reviewed when:

1. New quality enforcement mechanisms are proposed
1. Existing policies need clarification or amendment
1. Phase progression is being evaluated
1. Major architectural changes impact quality processes

Last reviewed: 2026-03-06
Next review: As needed
