# Mem0 Compatibility Layer (MEM-005)

LAUP provides a Mem0-style integration facade in `packages/core/src/memory-mem0.ts`.

## What is compatible

- Python SDK-style `memory.add(...)`
- REST-style `memory.search({...})`
- REST-style `memory.delete(...)`

## Usage

```ts
import {
  DefaultMem0ContextResolver,
  InMemoryMemoryStore,
  Mem0MemoryClient,
} from "@laup/core";

const store = new InMemoryMemoryStore();
await store.init();

const memory = new Mem0MemoryClient(
  store,
  new DefaultMem0ContextResolver({ orgId: "org-default" }),
);

await memory.add("Remember this", {
  user_id: "org-1",
  agent_id: "project-1",
  run_id: "session-1",
  metadata: { source: "app" },
});

const results = await memory.search({
  query: "remember",
  user_id: "org-1",
  agent_id: "project-1",
  run_id: "session-1",
  limit: 5,
});

await memory.delete({
  memory_id: results[0]!.id,
  user_id: "org-1",
  agent_id: "project-1",
  run_id: "session-1",
});
```

## Context mapping

By default, Mem0 IDs map to LAUP scope context as:

- `user_id` -> `orgId`
- `agent_id` -> `projectId`
- `run_id` -> `sessionId`

The resolver is pluggable if your environment needs a different mapping.
