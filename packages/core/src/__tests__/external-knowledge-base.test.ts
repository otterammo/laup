import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  annotateExternalKnowledgeResults,
  ConfluenceKnowledgeBaseConnector,
  ExternalKnowledgeSyncService,
  isExternalKnowledgeRecord,
  listMemoryIncludingExternalSources,
  NotionKnowledgeBaseConnector,
  searchMemoryIncludingExternalSources,
} from "../external-knowledge-base.js";
import { createSemanticMemoryStore, type MemoryEmbeddingProvider } from "../memory-store.js";

const CONTEXT = { orgId: "org-1" };

class KeywordEmbeddingProvider implements MemoryEmbeddingProvider {
  constructor(private readonly dimensions: string[]) {}

  async embed(input: string): Promise<number[]> {
    const text = input.toLowerCase();
    return this.dimensions.map((dimension) => {
      const escaped = dimension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = text.match(new RegExp(`\\b${escaped}\\b`, "g"));
      return matches?.length ?? 0;
    });
  }
}

describe("external knowledge base connectors", () => {
  it("fetches and normalizes Confluence pages", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: "123",
                title: "Incident Runbook",
                _links: { webui: "/spaces/OPS/pages/123" },
                version: { when: "2026-03-05T08:00:00.000Z" },
                body: { storage: { value: "<p>Restart the worker pool.</p>" } },
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const connector = new ConfluenceKnowledgeBaseConnector({
      baseUrl: "https://acme.atlassian.net",
      spaceKey: "OPS",
      authToken: "token",
      fetcher,
    });

    const docs = await connector.listDocuments();
    expect(docs).toEqual([
      {
        externalId: "123",
        title: "Incident Runbook",
        content: "Restart the worker pool.",
        sourceUrl: "https://acme.atlassian.net/spaces/OPS/pages/123",
        updatedAt: "2026-03-05T08:00:00.000Z",
      },
    ]);
  });

  it("fetches and normalizes Notion pages", async () => {
    const fetcher: typeof fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: "page-1",
                url: "https://notion.so/page-1",
                last_edited_time: "2026-03-04T12:00:00.000Z",
                properties: {
                  Name: {
                    type: "title",
                    title: [{ plain_text: "Release Checklist" }],
                  },
                  Notes: {
                    type: "rich_text",
                    rich_text: [{ plain_text: "Ship after QA sign-off" }],
                  },
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const connector = new NotionKnowledgeBaseConnector({
      authToken: "token",
      databaseId: "db-1",
      fetcher,
    });

    const docs = await connector.listDocuments();
    expect(docs[0]?.externalId).toBe("page-1");
    expect(docs[0]?.content).toContain("Release Checklist");
    expect(docs[0]?.content).toContain("Ship after QA sign-off");
  });
});

describe("external knowledge sync service", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("indexes external KB entries so they are searchable in memory API and marked as external", async () => {
    const memoryStore = createSemanticMemoryStore({
      embeddingProvider: new KeywordEmbeddingProvider(["runbook", "restart", "release"]),
    });

    const connector = {
      provider: "confluence" as const,
      listDocuments: vi.fn(async () => [
        {
          externalId: "runbook-1",
          title: "Restart Runbook",
          content: "Runbook for restart procedure",
          sourceUrl: "https://kb.example/runbook-1",
        },
      ]),
    };

    const service = new ExternalKnowledgeSyncService(memoryStore, [connector], {
      context: CONTEXT,
    });

    const sync = await service.syncOnce();
    expect(sync).toEqual([{ provider: "confluence", indexedCount: 1 }]);

    const results = await searchMemoryIncludingExternalSources(
      memoryStore,
      "restart runbook",
      "org",
      CONTEXT,
      { k: 5 },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.external).toBe(true);
    expect(
      isExternalKnowledgeRecord(results[0]?.memory as NonNullable<(typeof results)[0]>["memory"]),
    ).toBe(true);

    const annotated = annotateExternalKnowledgeResults(results);
    expect(annotated[0]?.external).toBe(true);

    const listed = await listMemoryIncludingExternalSources(memoryStore, "org", CONTEXT);
    expect(listed[0]?.external).toBe(true);
  });

  it("uses hourly sync interval by default", () => {
    const memoryStore = createSemanticMemoryStore();
    const connector = {
      provider: "notion" as const,
      listDocuments: vi.fn(async () => []),
    };

    const service = new ExternalKnowledgeSyncService(memoryStore, [connector], {
      context: CONTEXT,
    });

    expect(service.getSyncIntervalMs()).toBe(60 * 60 * 1000);
  });

  it("runs scheduled sync on configured interval", async () => {
    vi.useFakeTimers();

    const memoryStore = createSemanticMemoryStore();
    const connector = {
      provider: "notion" as const,
      listDocuments: vi.fn(async () => []),
    };

    const service = new ExternalKnowledgeSyncService(memoryStore, [connector], {
      context: CONTEXT,
      syncIntervalMs: 10,
    });

    service.start();
    await vi.advanceTimersByTimeAsync(25);
    service.stop();

    expect(connector.listDocuments).toHaveBeenCalledTimes(2);
  });
});
