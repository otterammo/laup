# Standard Context Packet Format (HAND-001)

This document defines the standard handoff context packet used for agent-to-agent transfers.

Implementation source: `packages/core/src/handoff-schema.ts` (`ContextPacketSchema`)

## Versioning

- `schemaVersion` **MUST** follow semantic versioning (`MAJOR.MINOR.PATCH`)
- Example: `1.0.0`

## Required Fields

The packet **MUST** include all of the following required fields:

- `packetId` (string)
- `schemaVersion` (semver string)
- `sendingTool` (string)
- `receivingTool` (string)
- `task` (object)
- `workingContext` (object)
- `memoryRefs` (string[])
- `conversationSummary` (string)
- `constraints` (string[])
- `permissionPolicy` (object)
- `timestamp` (ISO datetime string)

## Tool-Agnostic Design

The schema is tool-agnostic:

- `sendingTool` / `receivingTool` are open string identifiers
- `task`, `workingContext`, and `permissionPolicy` are generic object payloads

## Machine Validation

The format is machine-validatable via Zod schema:

- `ContextPacketSchema.safeParse(packet)`
- `ContextPacketSchema.parse(packet)`

This satisfies the HAND-001 requirement for a structured, serializable/deserializable packet format.

## Routing and History

For routing behavior (HAND-007), see `docs/handoff-routing.md`.

Handoff history entries can include a `routingDecision` record to capture how the receiving tool was selected.
