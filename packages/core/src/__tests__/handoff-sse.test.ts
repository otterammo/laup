import { afterEach, describe, expect, it, vi } from "vitest";
import { createHandoffQueue } from "../handoff-queue.js";
import type { ContextPacket } from "../handoff-schema.js";
import {
  createHandoffSseSession,
  SSE_HEADERS,
  serializeSseComment,
  serializeSseEvent,
} from "../handoff-sse.js";

describe("handoff-sse (HAND-012)", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes event and comment frames", () => {
    expect(
      serializeSseEvent({
        id: "pkt-1",
        event: "handoff",
        retry: 3000,
        data: { ok: true },
      }),
    ).toBe('id: pkt-1\nevent: handoff\nretry: 3000\ndata: {"ok":true}\n\n');

    expect(serializeSseComment("ping\nunsafe")).toBe(": ping unsafe\n\n");
  });

  it("streams replay backlog and new handoff events", async () => {
    const queue = createHandoffQueue();
    await queue.enqueue(packet("pkt-replay", "claude-code"));

    const writes: string[] = [];
    const session = createHandoffSseSession(queue, {
      receivingTool: "claude-code",
      heartbeatMs: 10_000,
      now: () => new Date("2026-03-05T11:00:00.000Z"),
    });

    expect(session.headers).toEqual(SSE_HEADERS);

    const stop = await session.start((chunk) => {
      writes.push(chunk);
    });

    expect(writes[0]).toContain("event: ready");
    expect(writes[0]).toContain("connectedAt");

    expect(writes[1]).toContain("event: handoff");
    expect(writes[1]).toContain("pkt-replay");

    await queue.enqueue(packet("pkt-live", "claude-code"));
    await Promise.resolve();

    expect(writes.at(-1)).toContain("pkt-live");

    stop();
    await queue.enqueue(packet("pkt-ignored", "claude-code"));
    await Promise.resolve();

    expect(writes.some((chunk) => chunk.includes("pkt-ignored"))).toBe(false);
  });

  it("emits heartbeat comments while connected", async () => {
    vi.useFakeTimers();

    const queue = createHandoffQueue();
    const writes: string[] = [];
    const session = createHandoffSseSession(queue, {
      receivingTool: "claude-code",
      heartbeatMs: 1_000,
      now: () => new Date("2026-03-05T11:00:00.000Z"),
    });

    const stop = await session.start((chunk) => {
      writes.push(chunk);
    });

    await vi.advanceTimersByTimeAsync(1_050);
    expect(writes.some((chunk) => chunk.startsWith(": keepalive"))).toBe(true);

    stop();
  });

  it("validates session options", () => {
    const queue = createHandoffQueue();

    expect(() =>
      createHandoffSseSession(queue, {
        receivingTool: "claude-code",
        replayLimit: 0,
      }),
    ).toThrow(/replayLimit/i);

    expect(() =>
      createHandoffSseSession(queue, {
        receivingTool: "claude-code",
        heartbeatMs: 0,
      }),
    ).toThrow(/heartbeatMs/i);
  });
});
