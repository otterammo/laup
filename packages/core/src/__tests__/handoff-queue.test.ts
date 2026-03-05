import { describe, expect, it } from "vitest";
import { createHandoffQueue, MIN_HANDOFF_RETENTION_MS } from "../handoff-queue.js";
import type { ContextPacket } from "../handoff-schema.js";

describe("handoff-queue (HAND-005)", () => {
  const packet = (id: string, receivingTool = "claude-code"): ContextPacket => ({
    packetId: id,
    schemaVersion: "1.0.0",
    sendingTool: "codex",
    receivingTool,
    task: { title: "ship async handoff" },
    workingContext: {},
    memoryRefs: [],
    conversationSummary: "handoff",
    constraints: [],
    permissionPolicy: {},
    timestamp: "2026-03-01T00:00:00.000Z",
    compressed: false,
  });

  it("enqueues async packet and returns immediately with queued status", async () => {
    const queue = createHandoffQueue();
    const record = await queue.enqueue(packet("pkt-1"));

    expect(record.packetId).toBe("pkt-1");
    expect(record.status).toBe("queued");

    const status = await queue.getStatus("pkt-1");
    expect(status?.status).toBe("queued");
  });

  it("enforces minimum retention of 7 days with configurable value", () => {
    expect(() => createHandoffQueue({ retentionMs: MIN_HANDOFF_RETENTION_MS - 1 })).toThrow(
      /at least 7 days/i,
    );

    expect(() => createHandoffQueue({ retentionMs: MIN_HANDOFF_RETENTION_MS + 1 })).not.toThrow();
  });

  it("lets receiving agent poll for new packets and tracks delivered status", async () => {
    const queue = createHandoffQueue();
    await queue.enqueue(packet("pkt-2", "claude-code"));
    await queue.enqueue(packet("pkt-3", "copilot"));

    const pulled = await queue.poll("claude-code");
    expect(pulled).toHaveLength(1);
    expect(pulled[0]?.packetId).toBe("pkt-2");

    const deliveredStatus = await queue.getStatus("pkt-2");
    expect(deliveredStatus?.status).toBe("delivered");
    expect(deliveredStatus?.deliveredAt).toBeTruthy();

    const secondPoll = await queue.poll("claude-code");
    expect(secondPoll).toHaveLength(0);
  });

  it("supports subscribe mode for new packets", async () => {
    const queue = createHandoffQueue();

    const seen: string[] = [];
    const unsubscribe = queue.subscribe("claude-code", async (queuedPacket) => {
      seen.push(queuedPacket.packetId);
    });

    await queue.enqueue(packet("pkt-4", "claude-code"));
    await Promise.resolve();

    expect(seen).toEqual(["pkt-4"]);

    unsubscribe();
    await queue.enqueue(packet("pkt-5", "claude-code"));
    await Promise.resolve();

    expect(seen).toEqual(["pkt-4"]);
  });
});
