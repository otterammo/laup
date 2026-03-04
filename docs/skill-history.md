# Skill History Storage (SKILL-011)

LAUP core provides append-only history storage for skill installation and usage events.

## Guarantees

- Install events include `skillId`, `projectId`, `version`, `actor`, and `timestamp`
- Usage events include `skillId`, `projectId`, `invocationCount`, and `timestamp`
- History is immutable (append-only): only insert, query, and retention pruning are supported
- Query supports filtering by `skillId` and date range (`startTime` / `endTime`)
- Retention policy keeps at least 24 months of history

## API

From `@laup/core`:

- `InMemorySkillHistoryStorage`
- `SqlSkillHistoryStorage`
- `createSkillHistoryStorage(db)`
- `MIN_SKILL_HISTORY_RETENTION_MONTHS` (currently `24`)

## Retention behavior

`prune(before?)` never deletes records newer than the policy cutoff (`now - 24 months`).
If a later `before` date is provided, the storage clamps pruning to the retention cutoff.
