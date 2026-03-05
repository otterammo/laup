import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStorage } from "../audit-storage.js";
import { InMemoryDbAdapter } from "../db-adapter.js";
import {
  type HandoffHistoryStorage,
  InMemoryHandoffHistoryStorage,
  MIN_HANDOFF_HISTORY_RETENTION_MONTHS,
  SqlHandoffHistoryStorage,
} from "../handoff-history.js";

describe("handoff-history (HAND-008)", () => {
  let storage: HandoffHistoryStorage;

  beforeEach(async () => {
    storage = new InMemoryHandoffHistoryStorage(() => new Date("2026-03-05T08:00:00.000Z"));
    await storage.init();
  });

  it("records sent/received/acknowledged lifecycle events with required metadata", async () => {
    await storage.recordSent({
      packetId: "packet-1",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Implement HAND-008",
      sentAt: "2026-03-05T07:00:00.000Z",
    });
    await storage.recordReceived({
      packetId: "packet-1",
      eventAt: "2026-03-05T07:00:02.000Z",
    });
    await storage.recordAcknowledged({
      packetId: "packet-1",
      eventAt: "2026-03-05T07:00:05.000Z",
    });

    const events = await storage.query({ packetId: "packet-1" });
    expect(events.map((event) => event.status)).toEqual(["sent", "received", "acknowledged"]);
    expect(events[2]).toMatchObject({
      packetId: "packet-1",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Implement HAND-008",
      sentAt: "2026-03-05T07:00:00.000Z",
      eventAt: "2026-03-05T07:00:05.000Z",
      status: "acknowledged",
    });
  });

  it("records rejected and expired events", async () => {
    await storage.recordSent({
      packetId: "packet-2",
      sendingTool: "cursor",
      receivingTool: "codex",
      taskSummary: "Analyze traces",
      sentAt: "2026-03-05T07:10:00.000Z",
    });
    await storage.recordRejected({ packetId: "packet-2", eventAt: "2026-03-05T07:11:00.000Z" });

    await storage.recordSent({
      packetId: "packet-3",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Run tests",
      sentAt: "2026-03-05T07:20:00.000Z",
    });
    await storage.recordExpired({ packetId: "packet-3", eventAt: "2026-03-05T07:30:00.000Z" });

    const rejected = await storage.query({ status: "rejected" });
    const expired = await storage.query({ status: "expired" });

    expect(rejected).toHaveLength(1);
    expect(expired).toHaveLength(1);
    expect(rejected[0]?.packetId).toBe("packet-2");
    expect(expired[0]?.packetId).toBe("packet-3");
  });

  it("supports querying by packetId, tool, date range, and status", async () => {
    await storage.recordSent({
      packetId: "packet-a",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Task A",
      sentAt: "2026-03-04T23:59:59.000Z",
    });
    await storage.recordSent({
      packetId: "packet-b",
      sendingTool: "codex",
      receivingTool: "cursor",
      taskSummary: "Task B",
      sentAt: "2026-03-05T07:00:00.000Z",
    });
    await storage.recordReceived({ packetId: "packet-b", eventAt: "2026-03-05T07:00:03.000Z" });

    const byPacket = await storage.query({ packetId: "packet-b" });
    expect(byPacket).toHaveLength(2);

    const byTool = await storage.query({ tool: "cursor" });
    expect(byTool.map((event) => event.packetId)).toEqual(["packet-b", "packet-b"]);

    const byDate = await storage.query({
      startTime: new Date("2026-03-05T00:00:00.000Z"),
      endTime: new Date("2026-03-06T00:00:00.000Z"),
    });
    expect(byDate.every((event) => event.packetId === "packet-b")).toBe(true);

    const byStatus = await storage.query({ status: "received" });
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0]?.packetId).toBe("packet-b");
  });

  it("retains at least 24 months when pruning", async () => {
    await storage.recordSent({
      packetId: "packet-keep",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Keep me",
      sentAt: "2024-03-10T00:00:00.000Z",
    });
    await storage.recordSent({
      packetId: "packet-drop",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Drop me",
      sentAt: "2024-03-01T23:59:59.000Z",
    });

    const pruned = await storage.prune(new Date("2026-03-01T00:00:00.000Z"));
    expect(pruned).toBe(1);

    const remaining = await storage.query({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.packetId).toBe("packet-keep");
    expect(MIN_HANDOFF_HISTORY_RETENTION_MONTHS).toBe(24);
  });

  it("writes handoff lifecycle entries into audit trail integration", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();
    const auditedStorage = new InMemoryHandoffHistoryStorage(
      () => new Date("2026-03-05T08:00:00.000Z"),
      auditStorage,
    );
    await auditedStorage.init();

    await auditedStorage.recordSent({
      packetId: "packet-audit",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Audit me",
      sentAt: "2026-03-05T07:00:00.000Z",
    });

    const auditPage = await auditStorage.query({ category: "handoff" });
    expect(auditPage.total).toBe(1);
    expect(auditPage.entries[0]).toMatchObject({
      category: "handoff",
      action: "handoff.sent",
      targetId: "packet-audit",
      metadata: expect.objectContaining({ status: "sent" }),
    });
  });

  it("persists sql history records", async () => {
    const db = new InMemoryDbAdapter();
    await db.connect();

    const sqlStorage = new SqlHandoffHistoryStorage(db, () => new Date("2026-03-05T08:00:00.000Z"));
    await sqlStorage.init();

    await sqlStorage.recordSent({
      packetId: "packet-sql",
      sendingTool: "codex",
      receivingTool: "claude-code",
      taskSummary: "Persist in SQL",
      sentAt: "2026-03-05T07:00:00.000Z",
    });

    const rows = await db.query<{ packet_id: string; status: string }>(
      "SELECT packet_id, status FROM handoff_history_events",
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      packet_id: "packet-sql",
      status: "sent",
    });

    await db.disconnect();
  });
});
