import type { HandoffQueue } from "./handoff-queue.js";
import type { ContextPacket } from "./handoff-schema.js";

export const DEFAULT_HANDOFF_SSE_HEARTBEAT_MS = 15_000;
export const DEFAULT_HANDOFF_SSE_REPLAY_LIMIT = 50;

export type HandoffSseEventName = "ready" | "handoff" | "error";

export interface HandoffSseEvent<TPayload = unknown> {
  event: HandoffSseEventName;
  data: TPayload;
  id?: string;
  retry?: number;
}

export interface HandoffSseSessionOptions {
  receivingTool: string;
  heartbeatMs?: number;
  replayLimit?: number;
  retryMs?: number;
  now?: () => Date;
}

export interface HandoffSseSession {
  headers: Record<string, string>;
  start(writeChunk: (chunk: string) => void | Promise<void>): Promise<() => void>;
}

interface ReadyEventPayload {
  receivingTool: string;
  connectedAt: string;
}

interface HandoffEventPayload {
  packet: ContextPacket;
}

interface ErrorEventPayload {
  message: string;
}

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function serializeSseEvent<TPayload>(event: HandoffSseEvent<TPayload>): string {
  const lines: string[] = [];

  if (event.id) lines.push(`id: ${sanitizeSseLine(event.id)}`);
  lines.push(`event: ${sanitizeSseLine(event.event)}`);
  if (typeof event.retry === "number" && Number.isFinite(event.retry) && event.retry >= 0) {
    lines.push(`retry: ${Math.floor(event.retry)}`);
  }

  const payload = JSON.stringify(event.data);
  for (const line of payload.split("\n")) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
}

export function serializeSseComment(comment: string): string {
  return `: ${sanitizeSseLine(comment)}\n\n`;
}

export function createHandoffSseSession(
  queue: HandoffQueue,
  options: HandoffSseSessionOptions,
): HandoffSseSession {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HANDOFF_SSE_HEARTBEAT_MS;
  const replayLimit = options.replayLimit ?? DEFAULT_HANDOFF_SSE_REPLAY_LIMIT;
  const retryMs = options.retryMs;
  const now = options.now ?? (() => new Date());

  if (!Number.isInteger(replayLimit) || replayLimit < 1) {
    throw new Error("replayLimit must be a positive integer");
  }
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
    throw new Error("heartbeatMs must be > 0");
  }

  return {
    headers: { ...SSE_HEADERS },
    async start(writeChunk) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const write = async (chunk: string): Promise<void> => {
        if (closed) return;
        await writeChunk(chunk);
      };

      const writeEvent = async <TPayload>(event: HandoffSseEvent<TPayload>): Promise<void> => {
        await write(serializeSseEvent(event));
      };

      await writeEvent<ReadyEventPayload>({
        event: "ready",
        ...(typeof retryMs === "number" ? { retry: retryMs } : {}),
        data: {
          receivingTool: options.receivingTool,
          connectedAt: now().toISOString(),
        },
      });

      const queuedPackets = await queue.poll(options.receivingTool, { limit: replayLimit });
      for (const queuedPacket of queuedPackets) {
        await writeEvent<HandoffEventPayload>({
          event: "handoff",
          id: queuedPacket.packetId,
          data: { packet: queuedPacket },
        });
      }

      const unsubscribe = queue.subscribe(options.receivingTool, async (packet) => {
        await writeEvent<HandoffEventPayload>({
          event: "handoff",
          id: packet.packetId,
          data: { packet },
        });
      });

      heartbeat = setInterval(() => {
        void write(serializeSseComment(`keepalive ${now().toISOString()}`)).catch(async (error) => {
          await writeEvent<ErrorEventPayload>({
            event: "error",
            data: { message: error instanceof Error ? error.message : String(error) },
          }).catch(() => {});
        });
      }, heartbeatMs);

      return () => {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      };
    },
  };
}

function sanitizeSseLine(input: string): string {
  return input.replace(/[\r\n]/g, " ").trim();
}
