import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDbAdapter } from "../db-adapter.js";
import { createAdapterUsageEmitter, createUsageCollector } from "../usage-collector.js";
import type { UsageStorage } from "../usage-storage.js";
import { InMemoryUsageStorage, SqlUsageStorage } from "../usage-storage.js";

describe("usage-collector", () => {
  let storage: UsageStorage;

  beforeEach(async () => {
    storage = new InMemoryUsageStorage();
    await storage.init();
  });

  it("collects usage across all usage event types", async () => {
    const collector = createUsageCollector({
      storage,
      defaultAttribution: { userId: "u-1", projectId: "p-1" },
      now: () => new Date("2026-03-03T21:25:00.000Z"),
      idFactory: () => "evt_fixed",
    });

    await collector.collectLlmCall({
      provider: "openai",
      model: "gpt-4.1",
      inputTokens: 120,
      outputTokens: 20,
      success: true,
    });

    await collector.collectMcpInvocation({
      serverId: "filesystem",
      toolName: "read_file",
      durationMs: 30,
      success: true,
    });

    await collector.collectSkillInvocation({
      skillId: "tools/git-commit",
      version: "1.0.0",
      durationMs: 50,
      success: false,
      error: "blocked",
    });

    await collector.collectMemoryOperation({
      operation: "write",
      scope: "session",
      itemCount: 1,
      sizeBytes: 256,
      durationMs: 3,
      success: true,
    });

    const result = await storage.query({});
    expect(result.total).toBe(4);
    expect(result.data.map((event) => event.type).sort()).toEqual([
      "llm-call",
      "mcp-invocation",
      "memory-operation",
      "skill-invocation",
    ]);

    for (const event of result.data) {
      expect(event.id).toMatch(/^evt_/);
      expect(event.attribution.userId).toBe("u-1");
      expect(event.attribution.projectId).toBe("p-1");
      expect(event.timestamp).toBe("2026-03-03T21:25:00.000Z");
    }
  });

  it("supports batch ingestion with per-event attribution", async () => {
    const collector = createUsageCollector({
      storage,
      defaultAttribution: { orgId: "org-1" },
      idFactory: (() => {
        let next = 1;
        return () => `evt_${next++}`;
      })(),
    });

    const created = await collector.collectBatch([
      {
        type: "llm-call",
        data: {
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          inputTokens: 200,
          outputTokens: 100,
          success: true,
        },
        attribution: { userId: "u-1" },
      },
      {
        type: "memory-operation",
        data: {
          operation: "search",
          scope: "project",
          success: true,
        },
        attribution: { userId: "u-2" },
      },
    ]);

    expect(created.map((event) => event.id)).toEqual(["evt_1", "evt_2"]);

    const first = await storage.query({ userId: "u-1" });
    expect(first.total).toBe(1);
    expect(first.data[0]?.attribution.orgId).toBe("org-1");
  });

  it("provides adapter-facing helper contract with normalized attribution", async () => {
    const collector = createUsageCollector({
      storage,
      defaultAttribution: { sessionId: "s-1" },
    });

    const emitter = createAdapterUsageEmitter(collector, {
      adapterId: "codex",
      category: "cli",
      attribution: { teamId: "t-1" },
    });

    await emitter.emitLlmCall({
      provider: "openai",
      model: "gpt-5",
      inputTokens: 10,
      outputTokens: 4,
      success: true,
    });

    const result = await storage.query({ adapterId: "codex", toolCategory: "cli" });
    expect(result.total).toBe(1);
    expect(result.data[0]?.attribution.teamId).toBe("t-1");
    expect(result.data[0]?.attribution.sessionId).toBe("s-1");
  });

  it("integrates with sql usage storage persistence", async () => {
    const db = new InMemoryDbAdapter();
    await db.connect();

    const sqlStorage = new SqlUsageStorage(db);
    await sqlStorage.init();

    const collector = createUsageCollector({
      storage: sqlStorage,
      defaultAttribution: { userId: "sql-user" },
    });

    await collector.collectMemoryOperation({
      operation: "read",
      scope: "project",
      success: true,
    });

    const persisted = await db.query("SELECT * FROM usage_events");
    expect(persisted.rowCount).toBe(1);

    await db.disconnect();
  });
});
