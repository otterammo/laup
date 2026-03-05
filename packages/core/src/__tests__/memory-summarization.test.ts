import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryMemoryStore } from "../memory-store.js";
import { MemorySummarizationPipeline } from "../memory-summarization.js";

describe("memory-summarization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("summarizes old memories, references originals, and archives originals", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const context = { orgId: "org-1", projectId: "proj-1", sessionId: "sess-1" };

    await store.write({
      id: "old-1",
      content: "Remember to rotate staging credentials every month.",
      scope: "project",
      context,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });
    await store.write({
      id: "old-2",
      content: "Deployment checklist includes smoke tests and rollback validation.",
      scope: "project",
      context,
      now: new Date("2026-02-03T00:00:00.000Z"),
    });

    const pipeline = new MemorySummarizationPipeline(store, {
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });

    pipeline.configureProject(
      { orgId: "org-1", projectId: "proj-1" },
      {
        enabled: true,
        scheduleMs: 60_000,
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
        minRecords: 2,
      },
    );

    const result = await pipeline.runNow({ orgId: "org-1", projectId: "proj-1" });
    expect(result.skipped).toBe(false);
    expect(result.summarizedCount).toBe(2);

    const projectMemories = await store.listByScope("project", context);
    const summary = projectMemories.find((record) => record.id === result.summaryId);
    const summaryMetadata = summary?.metadata as { originalMemoryIds?: string[] } | undefined;
    expect(summary?.category).toBe("memory-summary");
    expect(summaryMetadata?.originalMemoryIds).toEqual(["old-1", "old-2"]);

    const archivedOne = await store.getById("old-1", context);
    const archivedTwo = await store.getById("old-2", context);
    const archivedOneMetadata = archivedOne?.metadata as
      | { archived?: boolean; summaryId?: string }
      | undefined;
    const archivedTwoMetadata = archivedTwo?.metadata as { archived?: boolean } | undefined;
    expect(archivedOneMetadata?.archived).toBe(true);
    expect(archivedTwoMetadata?.archived).toBe(true);
    expect(archivedOneMetadata?.summaryId).toBe(summary?.id);
  });

  it("supports per-project enable/disable configuration", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const context = { orgId: "org-1", projectId: "proj-2", sessionId: "sess-1" };
    await store.write({
      id: "old-1",
      content: "An old memory",
      scope: "project",
      context,
      now: new Date("2026-02-01T00:00:00.000Z"),
    });

    const pipeline = new MemorySummarizationPipeline(store, {
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });

    pipeline.configureProject(
      { orgId: "org-1", projectId: "proj-2" },
      {
        enabled: false,
        scheduleMs: 60_000,
        maxAgeMs: 24 * 60 * 60 * 1000,
        minRecords: 1,
      },
    );

    const result = await pipeline.runNow({ orgId: "org-1", projectId: "proj-2" });
    expect(result.skipped).toBe(true);

    const memories = await store.listByScope("project", context);
    expect(memories).toHaveLength(1);
  });

  it("runs summarization on a configurable schedule", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const context = { orgId: "org-1", projectId: "proj-3", sessionId: "sess-1" };
    await store.write({
      id: "old-1",
      content: "first",
      scope: "project",
      context,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const pipeline = new MemorySummarizationPipeline(store, {
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });

    pipeline.configureProject(
      { orgId: "org-1", projectId: "proj-3" },
      {
        enabled: true,
        scheduleMs: 1_000,
        maxAgeMs: 24 * 60 * 60 * 1000,
        minRecords: 1,
      },
    );

    pipeline.start();
    await vi.advanceTimersByTimeAsync(1_100);
    pipeline.stop();

    const memories = await store.listByScope("project", context);
    expect(memories.some((record) => record.category === "memory-summary")).toBe(true);
  });
});
