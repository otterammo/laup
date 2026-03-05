# Semantic Memory Retrieval (MEM-002)

`@laup/core` now supports semantic retrieval of memories with natural-language queries.

## Highlights

- Memories are embedded at write time
- Embedding model is configurable (`defaultEmbeddingModel` + per-write override)
- Retrieval ranks results by cosine similarity
- Top-K results are supported (`k`, default `10`)
- Optional filtered retrieval by memory `tags` and `category`

## API

See `packages/core/src/memory-store.ts`:

- `MemoryEmbeddingProvider`
- `MemoryStore#semanticSearch(query, scope, context, options)`
- `MemorySearchOptions` (`k`, `embeddingModel`, scope visibility options, retrieval `filter`)
- `MemorySearchResult` (`memory`, `score`)

## Example

```ts
import { createSemanticMemoryStore } from "@laup/core";

const store = createSemanticMemoryStore({
  embeddingProvider: {
    embed: async (text) => myEmbeddingClient.embed(text),
  },
  defaultEmbeddingModel: "text-embedding-3-small",
  defaultTopK: 10,
});

await store.write({
  content: "Postmortem: DB migration lock contention on deploy",
  scope: "project",
  context: { orgId: "org-1", projectId: "proj-1" },
  tags: ["incident", "database"],
  category: "postmortem",
});

const hits = await store.semanticSearch(
  "what happened during database deploy incident?",
  "project",
  { orgId: "org-1", projectId: "proj-1" },
  { k: 5, filter: { tags: ["incident"], categories: ["postmortem"] } },
);
```
