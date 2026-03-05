import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryHandoffHistoryStorage } from "../handoff-history.js";
import { HandoffManager, HandoffTimeoutError } from "../handoff-manager.js";
import { createHandoffQueue } from "../handoff-queue.js";
import type { ContextPacket } from "../handoff-schema.js";

describe("handoff-manager (HAND-004)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const packet: ContextPacket = {
    packetId: "packet-77",
    schemaVersion: "1.0.0",
    sendingTool: "codex",
    receivingTool: "claude",
    task: { type: "implement" },
    workingContext: { mode: "sync", timeoutSeconds: 60 },
    memoryRefs: [],
    conversationSummary: "sync handoff",
    constraints: [],
    permissionPolicy: {},
    timestamp: "2026-03-05T07:00:00Z",
    compressed: false,
  };

  it("blocks in sync mode until the receiving agent acknowledges", async () => {
    let resolveAck:
      | ((value: {
          packetId: string;
          agentId: string;
          status: "accepted";
          timestamp: string;
        }) => void)
      | undefined;
    const manager = new HandoffManager();

    const sendPromise = manager.send(packet, {
      sourceAgent: "sender-1",
      targetAgent: "receiver-1",
      mode: "sync",
      waitForAck: () =>
        new Promise((resolve) => {
          resolveAck = resolve;
        }),
    });

    let settled = false;
    void sendPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveAck?.({
      packetId: packet.packetId,
      agentId: "receiver-1",
      status: "accepted",
      timestamp: "2026-03-05T07:00:05Z",
    });

    const result = await sendPromise;
    expect(result.status).toBe("acknowledged");
    expect(result.history.status).toBe("acknowledged");
    expect(result.history.timestamps.acknowledged).toBe("2026-03-05T07:00:05Z");
  });

  it("uses a default timeout of 60 seconds", async () => {
    vi.useFakeTimers();
    const manager = new HandoffManager();

    const sendPromise = manager.send(packet, {
      sourceAgent: "sender-1",
      targetAgent: "receiver-1",
      mode: "sync",
      waitForAck: () => new Promise(() => {}),
    });

    await vi.advanceTimersByTimeAsync(59_999);
    await Promise.resolve();

    let rejected = false;
    void sendPromise.catch(() => {
      rejected = true;
    });
    expect(rejected).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(sendPromise).rejects.toBeInstanceOf(HandoffTimeoutError);
    expect(manager.getHistory()).toHaveLength(1);
    expect(manager.getHistory()[0]?.status).toBe("timeout");
  });

  it("records acknowledgment details in handoff history", async () => {
    const manager = new HandoffManager();

    const result = await manager.send(packet, {
      sourceAgent: "sender-1",
      targetAgent: "receiver-1",
      mode: "sync",
      waitForAck: async () => ({
        packetId: packet.packetId,
        agentId: "receiver-1",
        status: "accepted",
        timestamp: "2026-03-05T07:00:10Z",
      }),
    });

    expect(result.history.mode).toBe("sync");
    expect(result.history.status).toBe("acknowledged");
    expect(result.history.timestamps.sent).toBeDefined();
    expect(result.history.timestamps.acknowledged).toBe("2026-03-05T07:00:10Z");
    expect(result.history.timestamps.completed).toBeDefined();
  });

  it("queues delivery in async mode and returns queue record", async () => {
    const handoffQueue = createHandoffQueue();
    const manager = new HandoffManager({ handoffQueue });

    const result = await manager.send(packet, {
      sourceAgent: "sender-1",
      targetAgent: "receiver-1",
      mode: "async",
    });

    expect(result.status).toBe("sent");
    expect(result.queueRecord).toMatchObject({
      packetId: packet.packetId,
      status: "queued",
    });

    const queuedStatus = await handoffQueue.getStatus(packet.packetId);
    expect(queuedStatus?.status).toBe("queued");
    expect(result.history.mode).toBe("async");
    expect(result.history.status).toBe("sent");
  });

  it("requires a queue when mode is async", async () => {
    const manager = new HandoffManager();

    await expect(
      manager.send(packet, {
        sourceAgent: "sender-1",
        targetAgent: "receiver-1",
        mode: "async",
      }),
    ).rejects.toThrow(/handoffQueue is required for async handoff mode/i);
  });

  it("writes handoff lifecycle events into HAND-008 storage", async () => {
    const historyStorage = new InMemoryHandoffHistoryStorage();
    await historyStorage.init();

    const manager = new HandoffManager({ historyStorage });
    await manager.send(packet, {
      sourceAgent: "sender-1",
      targetAgent: "receiver-1",
      mode: "sync",
      waitForAck: async () => ({
        packetId: packet.packetId,
        agentId: "receiver-1",
        status: "accepted",
        timestamp: "2026-03-05T07:00:10Z",
      }),
    });

    const events = await historyStorage.query({ packetId: packet.packetId });
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.status).sort()).toEqual([
      "acknowledged",
      "received",
      "sent",
    ]);
    expect(events[0]).toMatchObject({
      packetId: packet.packetId,
      sendingTool: packet.sendingTool,
      receivingTool: packet.receivingTool,
    });
  });
});
