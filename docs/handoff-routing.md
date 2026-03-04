# Handoff Routing (HAND-007)

LAUP supports two routing modes for handoff packets:

- **Direct routing**: route to a specific tool by name.
- **Policy routing**: choose from available tools using task type match, availability, and estimated cost.

Implementation source: `packages/core/src/handoff-routing.ts`

## Policy Scopes

Routing policy can be configured at multiple scopes and is merged with the same precedence used elsewhere in LAUP:

1. `org` (lowest precedence)
1. `team`
1. `project` (highest precedence)

Project settings override team/org values; team settings override org values.

## Inputs for Policy Selection

Policy-based routing evaluates candidates using:

- **availability** (`available: true` only)
- **task type fit** (`packet.task.type` vs `supportedTaskTypes[]`)
- **estimated cost** (`estimatedCost`)

## Recording Routing Decisions

`HandoffHistoryEntrySchema` supports `routingDecision` so each handoff can store:

- selected routing mode
- selected tool
- reason
- considered tools
- optional scored candidates
