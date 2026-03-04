import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDbAdapter } from "../db-adapter.js";
import {
  InMemorySkillHistoryStorage,
  MIN_SKILL_HISTORY_RETENTION_MONTHS,
  type SkillHistoryStorage,
  SqlSkillHistoryStorage,
} from "../skill-history.js";

describe("skill-history", () => {
  let storage: SkillHistoryStorage;

  beforeEach(async () => {
    storage = new InMemorySkillHistoryStorage(() => new Date("2026-03-04T20:00:00.000Z"));
    await storage.init();
  });

  it("records immutable install events with project/version/timestamp/actor", async () => {
    await storage.recordInstall({
      skillId: "acme/review",
      projectId: "project-1",
      version: "1.2.3",
      actor: "alice",
      timestamp: "2026-03-04T19:00:00.000Z",
    });

    const events = await storage.query({ skillId: "acme/review" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "install",
      skillId: "acme/review",
      projectId: "project-1",
      version: "1.2.3",
      actor: "alice",
      timestamp: "2026-03-04T19:00:00.000Z",
    });
  });

  it("records usage events with invocation count and timestamp", async () => {
    await storage.recordUsage({
      skillId: "acme/review",
      projectId: "project-1",
      invocationCount: 7,
      timestamp: "2026-03-04T19:30:00.000Z",
    });

    const events = await storage.query({ skillId: "acme/review", type: "usage" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "usage",
      invocationCount: 7,
      timestamp: "2026-03-04T19:30:00.000Z",
    });
  });

  it("queries history by skill ID and date range", async () => {
    await storage.recordUsage({
      skillId: "acme/review",
      projectId: "project-1",
      timestamp: "2026-02-01T10:00:00.000Z",
    });
    await storage.recordUsage({
      skillId: "acme/review",
      projectId: "project-1",
      timestamp: "2026-02-15T10:00:00.000Z",
    });
    await storage.recordUsage({
      skillId: "acme/other",
      projectId: "project-1",
      timestamp: "2026-02-15T10:00:00.000Z",
    });

    const events = await storage.query({
      skillId: "acme/review",
      startTime: new Date("2026-02-10T00:00:00.000Z"),
      endTime: new Date("2026-02-20T00:00:00.000Z"),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.skillId).toBe("acme/review");
    expect(events[0]?.timestamp).toBe("2026-02-15T10:00:00.000Z");
  });

  it("retains at least 24 months when pruning", async () => {
    await storage.recordUsage({
      skillId: "acme/review",
      projectId: "project-1",
      timestamp: "2024-03-10T00:00:00.000Z",
    });
    await storage.recordUsage({
      skillId: "acme/review",
      projectId: "project-1",
      timestamp: "2024-03-03T23:59:59.000Z",
    });

    const pruned = await storage.prune(new Date("2026-03-01T00:00:00.000Z"));
    expect(pruned).toBe(1);

    const remaining = await storage.query({ skillId: "acme/review" });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.timestamp).toBe("2024-03-10T00:00:00.000Z");
    expect(MIN_SKILL_HISTORY_RETENTION_MONTHS).toBe(24);
  });

  it("persists events through sql storage", async () => {
    const db = new InMemoryDbAdapter();
    await db.connect();

    const sqlStorage = new SqlSkillHistoryStorage(db, () => new Date("2026-03-04T20:00:00.000Z"));
    await sqlStorage.init();

    await sqlStorage.recordInstall({
      skillId: "acme/review",
      projectId: "project-1",
      version: "2.0.0",
      actor: "bob",
      timestamp: "2026-03-04T18:00:00.000Z",
    });

    const rows = await db.query<{ type: string; skill_id: string; version: string; actor: string }>(
      "SELECT type, skill_id, version, actor FROM skill_history_events",
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      type: "install",
      skill_id: "acme/review",
      version: "2.0.0",
      actor: "bob",
    });

    await db.disconnect();
  });
});
