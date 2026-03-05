import { beforeEach, describe, expect, it } from "vitest";
import {
  exportMemories,
  InMemoryMemoryStore,
  listMemoriesForExport,
  type MemoryContext,
  type MemoryStore,
} from "../memory-store.js";

describe("memory-store export", () => {
  let store: MemoryStore;

  const context: MemoryContext = {
    orgId: "org-1",
    projectId: "project-1",
    sessionId: "session-1",
  };

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init();

    await store.write({
      id: "mem-org",
      key: "org-key",
      content: "Org memory",
      scope: "org",
      context,
      tags: ["shared", "ops"],
      sourceToolId: "cli",
      now: new Date("2026-01-01T00:00:00.000Z"),
      metadata: { lastAccessedAt: "2026-01-02T00:00:00.000Z" },
    });

    await store.write({
      id: "mem-project",
      key: "project-key",
      content: "Project memory",
      scope: "project",
      context,
      tags: ["ops"],
      sourceToolId: "cursor",
      now: new Date("2026-01-03T00:00:00.000Z"),
    });

    await store.write({
      id: "mem-project-2",
      key: "project-key-2",
      content: "Project memory 2",
      scope: "project",
      context,
      tags: ["draft"],
      sourceToolId: "claude-code",
      now: new Date("2026-01-04T00:00:00.000Z"),
    });
  });

  it("exports JSON with required metadata fields", async () => {
    const result = await exportMemories(store, {
      format: "json",
      context,
    });

    const rows = JSON.parse(result.data) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: "mem-org",
      key: "org-key",
      scope: "org",
      tags: ["shared", "ops"],
      sourceToolId: "cli",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastAccessedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("exports CSV and supports scope/tag/date filtering", async () => {
    const result = await exportMemories(store, {
      format: "csv",
      context,
      scope: "project",
      tags: ["ops"],
      startDate: new Date("2026-01-02T00:00:00.000Z"),
      endDate: new Date("2026-01-05T00:00:00.000Z"),
    });

    expect(result.data).toContain(
      "id,key,scope,content,orgId,projectId,sessionId,tags,category,sourceToolId,createdAt,lastAccessedAt,expiresAt",
    );
    expect(result.data).toContain("mem-project,project-key,project,Project memory");
    expect(result.data).not.toContain("mem-org");
  });

  it("paginates large exports via cursor", async () => {
    const firstPage = await exportMemories(store, {
      format: "json",
      context,
      pageSize: 2,
    });
    const firstRows = JSON.parse(firstPage.data) as Array<Record<string, unknown>>;

    expect(firstRows).toHaveLength(2);
    expect(firstPage.nextCursor).toBe("2");

    const secondPage = await exportMemories(store, {
      format: "json",
      context,
      pageSize: 2,
      ...(firstPage.nextCursor ? { cursor: firstPage.nextCursor } : {}),
    });
    const secondRows = JSON.parse(secondPage.data) as Array<Record<string, unknown>>;

    expect(secondRows).toHaveLength(1);
    expect(secondRows[0]?.id).toBe("mem-project-2");
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("provides record pages for streaming workflows", async () => {
    const page = await listMemoriesForExport(store, {
      context,
      pageSize: 1,
    });

    expect(page.records).toHaveLength(1);
    expect(page.nextCursor).toBe("1");
  });
});
