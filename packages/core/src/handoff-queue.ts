import type { ContextPacket } from "./handoff-schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_HANDOFF_RETENTION_MS = 7 * DAY_MS;

export type HandoffQueuePacketStatus = "queued" | "delivered" | "expired";

export interface HandoffQueueRecord {
  packetId: string;
  status: HandoffQueuePacketStatus;
  queuedAt: string;
  expiresAt: string;
  deliveredAt?: string;
}

export interface HandoffQueueOptions {
  /** Retention window for queued/delivered packet records. Must be >= 7 days. */
  retentionMs?: number;
  /** Clock source override for deterministic tests. */
  now?: () => Date;
}

export type HandoffSubscriber = (
  packet: ContextPacket,
  record: HandoffQueueRecord,
) => void | Promise<void>;

export interface HandoffQueue {
  enqueue(packet: ContextPacket): Promise<HandoffQueueRecord>;
  getStatus(packetId: string): Promise<HandoffQueueRecord | null>;
  poll(receivingTool: string, options?: { limit?: number }): Promise<ContextPacket[]>;
  subscribe(receivingTool: string, handler: HandoffSubscriber): () => void;
  pruneExpired(now?: Date): Promise<number>;
}

interface QueueEntry {
  packet: ContextPacket;
  record: HandoffQueueRecord;
}

export class InMemoryHandoffQueue implements HandoffQueue {
  private readonly entries = new Map<string, QueueEntry>();
  private readonly subscribers = new Map<string, Set<HandoffSubscriber>>();
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(options: HandoffQueueOptions = {}) {
    const retentionMs = options.retentionMs ?? MIN_HANDOFF_RETENTION_MS;
    if (retentionMs < MIN_HANDOFF_RETENTION_MS) {
      throw new Error("Handoff queue retention must be at least 7 days");
    }

    this.retentionMs = retentionMs;
    this.now = options.now ?? (() => new Date());
  }

  async enqueue(packet: ContextPacket): Promise<HandoffQueueRecord> {
    const now = this.now();

    const record: HandoffQueueRecord = {
      packetId: packet.packetId,
      status: "queued",
      queuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.retentionMs).toISOString(),
    };

    this.entries.set(packet.packetId, { packet, record });

    const handlers = this.subscribers.get(packet.receivingTool);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        queueMicrotask(() => {
          Promise.resolve(handler(packet, { ...record })).catch(() => {});
        });
      }
    }

    return { ...record };
  }

  async getStatus(packetId: string): Promise<HandoffQueueRecord | null> {
    const entry = this.entries.get(packetId);
    if (!entry) return null;
    return { ...entry.record };
  }

  async poll(receivingTool: string, options?: { limit?: number }): Promise<ContextPacket[]> {
    const now = this.now();
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;

    const queued = Array.from(this.entries.values())
      .filter((entry) => {
        if (entry.packet.receivingTool !== receivingTool) return false;
        if (entry.record.status !== "queued") return false;
        return new Date(entry.record.expiresAt).getTime() > now.getTime();
      })
      .sort((a, b) => a.record.queuedAt.localeCompare(b.record.queuedAt))
      .slice(0, limit);

    for (const entry of queued) {
      entry.record.status = "delivered";
      entry.record.deliveredAt = now.toISOString();
    }

    return queued.map((entry) => entry.packet);
  }

  subscribe(receivingTool: string, handler: HandoffSubscriber): () => void {
    const handlers = this.subscribers.get(receivingTool) ?? new Set<HandoffSubscriber>();
    handlers.add(handler);
    this.subscribers.set(receivingTool, handlers);

    return () => {
      const current = this.subscribers.get(receivingTool);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.subscribers.delete(receivingTool);
      }
    };
  }

  async pruneExpired(now = this.now()): Promise<number> {
    let pruned = 0;

    for (const [packetId, entry] of this.entries) {
      if (new Date(entry.record.expiresAt).getTime() <= now.getTime()) {
        entry.record.status = "expired";
        this.entries.delete(packetId);
        pruned++;
      }
    }

    return pruned;
  }
}

export function createHandoffQueue(options?: HandoffQueueOptions): HandoffQueue {
  return new InMemoryHandoffQueue(options);
}
