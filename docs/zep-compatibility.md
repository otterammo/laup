# Zep Compatibility Layer (MEM-006, MEM-007)

LAUP provides a Zep-style integration facade in `packages/core/src/memory-zep.ts`.

## What is compatible

- Session-based memory model via `memory.session("...")`
- `add_memory(...)`
- `search_memory(...)`
- `get_memory(...)`
- `extract_memory(...)` for automatic memory extraction from full session transcripts

## Usage

```ts
import {
  DefaultZepContextResolver,
  InMemoryMemoryStore,
  ZepMemoryClient,
} from "@laup/core";

const store = new InMemoryMemoryStore();
await store.init();

const memory = new ZepMemoryClient(
  store,
  new DefaultZepContextResolver({
    orgId: "org-default",
    projectId: "project-default",
  }),
);

const session = memory.session("session-1");

await session.add_memory("User likes concise release notes", {
  topic: "preferences",
});

const results = await session.search_memory("release notes", { limit: 5 });

const one = await session.get_memory(results[0]?.uuid);

await session.extract_memory([
  { role: "assistant", content: "Let's capture preferences from this chat." },
  { role: "user", content: "Remember that I prefer concise summaries." },
  { role: "user", content: "I'm allergic to peanuts." },
]);
```

## Context mapping

By default, Zep session IDs map to LAUP context as:

- `session_id` -> `sessionId`
- `projectId` -> resolver default (`"zep"` if not set)
- `orgId` -> resolver default

Default scope is `session`, which keeps memories isolated per session.
You can override scope through `DefaultZepContextResolver`.
