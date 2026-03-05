# External Knowledge Base Integration (MEM-015)

LAUP supports read-only external knowledge ingestion into the semantic memory layer via
connector interfaces for Confluence and Notion.

Implementation lives in `packages/core/src/external-knowledge-base.ts`.

## Goals

- Ingest external KB documents into LAUP memory for retrieval/search
- Preserve source metadata (provider, external id, source URL, timestamps)
- Keep integration read-only with respect to external systems

## Read-only Behavior

- LAUP only performs **read/list** operations against external providers.
- No create, update, or delete operations are sent to Confluence or Notion.
- Indexed records are tagged as external and can be identified in retrieval responses.

## Core Types

- `ExternalKnowledgeBaseConnector`
  - `provider: "confluence" | "notion"`
  - `listDocuments(): Promise<ExternalKnowledgeDocument[]>`
- `ExternalKnowledgeDocument`
  - `externalId`, `title`, `content`, optional `sourceUrl`, `updatedAt`, `metadata`

## Built-in Connectors

- `ConfluenceKnowledgeBaseConnector`
  - Uses Confluence content search API
  - Normalizes page HTML to plain text
- `NotionKnowledgeBaseConnector`
  - Uses Notion database query API
  - Extracts title/rich text/select metadata summaries

## Sync Service

`ExternalKnowledgeSyncService` indexes connector documents into LAUP memory records with
stable ids/keys:

- `id`: `external:<provider>:<externalId>`
- `key`: `external:<provider>:<externalId>`
- metadata marker: `metadata.externalKnowledgeBase`
- category: `external-knowledge`
- tags include: `external-kb`, `<provider>`

Default schedule interval is hourly (`60 * 60 * 1000`), configurable via
`syncIntervalMs`.

## Retrieval Helpers

- `searchMemoryIncludingExternalSources(...)`
- `listMemoryIncludingExternalSources(...)`
- `annotateExternalKnowledgeResults(...)`
- `isExternalKnowledgeRecord(...)`

These helpers preserve regular memory retrieval while annotating external records with
`external: true`.

## Example

```ts
import {
  ConfluenceKnowledgeBaseConnector,
  ExternalKnowledgeSyncService,
  createSemanticMemoryStore,
  searchMemoryIncludingExternalSources,
} from "@laup/core";

const memoryStore = createSemanticMemoryStore();

const connector = new ConfluenceKnowledgeBaseConnector({
  baseUrl: "https://acme.atlassian.net",
  spaceKey: "OPS",
  authToken: process.env.CONFLUENCE_TOKEN!,
});

const sync = new ExternalKnowledgeSyncService(memoryStore, [connector], {
  context: { orgId: "acme" },
});

await sync.syncOnce();

const results = await searchMemoryIncludingExternalSources(
  memoryStore,
  "incident runbook",
  "org",
  { orgId: "acme" },
  { k: 5 },
);
```
