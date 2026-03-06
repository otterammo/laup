# Challenge Questions for Hard-Gate Rollout

**Requirement:** QBASE-003

## Overview

Before enabling hard-gate quality enforcement in CI (Phase 3 progression), critical policy and strategy questions must be answered and approved by project stakeholders. This document describes the challenge questions system and validation process.

## Purpose

Challenge questions capture decisions about:

- Quality enforcement thresholds and policies
- Technical debt management strategies
- Test governance and flake handling
- Documentation requirements
- Migration and rollout procedures

Documenting these decisions with approver sign-off ensures:

1. **Transparency:** All stakeholders understand the quality standards
1. **Accountability:** Decisions are attributed to specific approvers
1. **Consistency:** Policies are applied uniformly across the project
1. **Auditability:** Decision history is preserved for future reference

## File Location

Challenge questions are tracked in `quality/challenge-questions.md`.

## Schema

Each challenge question must include:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| **ID** | `Q-NNN` | Yes | Unique identifier (e.g., `Q-001`) |
| **Question** | String | Yes | The question that needs to be answered |
| **Context** | String | Yes | Why this question matters for the hard-gate rollout |
| **Answer** | String | Yes | The documented answer (blocks Phase 3 if missing/pending) |
| **Approver** | `@username` | Yes | GitHub handle of the person who approved the answer |
| **Approval Date** | ISO 8601 | Yes | Date when the answer was approved (YYYY-MM-DD) |

## Validation

Run the validation script to verify all challenge questions have been answered and approved:

```bash
pnpm run quality:validate-questions
```

**Exit codes:**

- `0`: All questions answered and approved → Phase 3 progression ALLOWED
- `1`: Unanswered or unapproved questions → Phase 3 progression BLOCKED
- `2`: Validation error (file not found, parse error, etc.)

## Progression Criteria

Phase 3 is blocked until:

- [ ] All challenge questions have documented answers (no pending, no empty values)
- [ ] All answers have approver sign-off (valid GitHub handle starting with `@`)
- [ ] All answers have approval dates (valid ISO 8601 date)

## Example

```markdown
### Q-001: Coverage Threshold Strategy

- **Question:** Should we enforce different coverage thresholds per package, or use a uniform threshold across all packages?
- **Context:** Current coverage varies widely (CLI at 0%, adapters at 86-96%, core at 63-80%). A uniform threshold may be too strict for some packages or too lenient for others.
- **Answer:** We will implement per-package thresholds based on current baseline with progressive improvement targets. Each package must maintain or improve its current coverage percentage, with a floor of 60% line coverage for any package with non-zero coverage. New packages must start at 80% minimum.
- **Approver:** @otterammo
- **Approval Date:** 2026-03-06
```

## Workflow

### Adding a New Challenge Question

1. Open `quality/challenge-questions.md`
1. Add a new `### Q-NNN:` section with the next sequential ID
1. Fill in **Question**, **Context**, and leave **Answer**, **Approver**, **Approval Date** as pending
1. Commit the change and open a PR for discussion

### Answering a Challenge Question

1. Discuss the question with stakeholders
1. Document the decision in the **Answer** field
1. Get approval from a project maintainer or stakeholder
1. Update **Approver** and **Approval Date**
1. Commit and push the change

### Validating Before Phase 3 Rollout

Before enabling hard-gate enforcement:

```bash
# Run validation
pnpm run quality:validate-questions

# Expected output if all questions answered:
# ✅ All challenge questions have been answered and approved
# ✓ Phase 3 progression is ALLOWED
```

If validation fails, review the error output and update `quality/challenge-questions.md` to address the missing or pending fields.

## Integration with CI

The validation script is designed to be integrated into CI pipelines. Add it as a required check before merging PRs that enable hard-gate enforcement:

```yaml
- name: Validate Challenge Questions
  run: pnpm run quality:validate-questions
```

## Relationship to Other Quality Requirements

- **QBASE-001:** Quality baseline provides the metrics that inform challenge question answers
- **QBASE-002:** Quality gaps (tracked in `quality/gaps.md`) reference challenge question decisions for resolution strategies
- **MIG-XXX:** Migration issues reference challenge questions for policy guidance during rollout

## Review Schedule

Challenge questions should be reviewed:

- Before Phase 3 rollout planning
- When new quality enforcement mechanisms are proposed
- When existing policies need clarification or amendment
- During major architectural changes that impact quality processes

## Frequently Asked Questions

### What happens if I need to change an approved answer?

Create a new question with a reference to the original, or update the answer with a new approver and approval date. Document the reason for the change in the answer text.

### Can I have multiple approvers?

The schema supports one approver per question. If multiple stakeholders need to approve, document the consensus in the answer text and list the primary decision-maker as the approver.

### What if the answer is complex and requires a separate document?

Summarize the decision in the **Answer** field and reference the separate document (e.g., "See docs/quality-strategy.md for full details").

### Are challenge questions required for Phase 1 or Phase 2?

No. Challenge questions are specific to Phase 3 hard-gate rollout. Earlier phases can operate with baseline and gap tracking alone.
