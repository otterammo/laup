# Memory Scope Semantics (MEM-001)

This document defines LAUP memory-scope behavior implemented in `packages/core/src/memory-store.ts`.

## Scopes

- `session` - ephemeral memory tied to `{ orgId, projectId, sessionId }`
- `project` - durable memory tied to `{ orgId, projectId }`
- `org` - durable memory tied to `{ orgId }`

## Persistence

- `session` memories get an `expiresAt` set on write, with a max TTL of 24 hours
- `project` memories do not expire automatically
- `org` memories do not expire automatically

## Visibility

Default reads are scope-local only:

- session reads see only session memories in the same org/project/session
- project reads see only project memories in the same org/project
- org reads see only org memories in the same org

Broader-scope visibility must be explicit via `includeSharedFromBroaderScopes: true`:

- session reads may include project + org memories for the same org/project
- project reads may include org memories for the same org

No implicit cross-org, cross-project, or cross-session leakage is allowed.

## Cross-tool Context Sharing (MEM-004)

Memory entries are shared across tools within the same scope context (`org`, `project`,
`session`) as soon as they are written.

- Every entry records a `sourceToolId` (defaults to `"unknown"` if omitted)
- Reads can optionally pass `requestingToolId` via `MemoryReadOptions`
- Cross-tool reads are audit-visible via metadata fields:
  - `requestingToolId`
  - `sourceToolId`
  - `crossToolRead` (`true` when reader and writer tool ids differ)

## Immutability

Memory scope is write-time immutable.

If a record with the same id already exists, attempting to write it with a different scope must fail.

## Conflict Resolution Strategies (MEM-011)

When duplicate writes target the same `{orgId, key}` concurrently, memory stores apply a
configurable strategy:

- `last-write-wins` (default) - conflicting write overwrites the existing record
- `first-write-wins` - conflicting write is rejected
- `manual-review` - conflicting write is queued in a review queue and must be resolved manually

Strategies can be configured globally via `conflictResolutionStrategy` or per project via
`conflictResolutionByProject(context)` in `MemoryStoreRuntimeOptions`.

Manual review queue API:

- `listConflicts(context, { status })`
- `resolveConflict(conflictId, "accept-incoming" | "keep-existing", context)`

## Audit Trail (MEM-012)

Memory stores can optionally emit audit entries for every memory operation by passing
`auditStorage` in `MemoryStoreRuntimeOptions`.

Recorded operations:

- `memory.init`
- `memory.write`
- `memory.listByScope`
- `memory.getById`
- `memory.getByKey`
- `memory.pruneExpired`
- `memory.conflict`
- `memory.conflict.resolved`

Audit entries use category `memory`, target type `memory`, and include operation metadata
(result counts, scope/context, and lookup outcomes where relevant).
