import type { HandoffHistoryStorage } from "./handoff-history.js";
import type { HandoffQueue, HandoffQueueRecord } from "./handoff-queue.js";
import type {
  ContextPacket,
  HandoffAck,
  HandoffHistoryEntry,
  HandoffMode,
  IncomingContextPacket,
} from "./handoff-schema.js";
import { type ContextField, createPartialPacket } from "./handoff-schema.js";

export class HandoffTimeoutError extends Error {
  readonly packetId: string;
  readonly timeoutSeconds: number;

  constructor(packetId: string, timeoutSeconds: number) {
    super(
      `Timed out waiting for handoff acknowledgment for packet "${packetId}" after ${timeoutSeconds} seconds`,
    );
    this.name = "HandoffTimeoutError";
    this.packetId = packetId;
    this.timeoutSeconds = timeoutSeconds;
  }
}

export interface SendHandoffOptions {
  mode?: HandoffMode;
  timeoutSeconds?: number;
  sourceAgent: string;
  targetAgent: string;
  waitForAck?: () => Promise<HandoffAck>;
  /** Field paths to include for partial handoff (CLI/API --include support, HAND-009) */
  include?: string[];
}

export interface SendHandoffResult {
  status: "sent" | "acknowledged" | "rejected";
  ack?: HandoffAck;
  queueRecord?: HandoffQueueRecord;
  history: HandoffHistoryEntry;
}

export class HandoffManager {
  private readonly history: HandoffHistoryEntry[] = [];
  private readonly now: () => Date;
  private readonly historyStorage: HandoffHistoryStorage | undefined;
  private readonly handoffQueue: HandoffQueue | undefined;

  constructor(options?: {
    now?: () => Date;
    historyStorage?: HandoffHistoryStorage;
    handoffQueue?: HandoffQueue;
  }) {
    this.now = options?.now ?? (() => new Date());
    this.historyStorage = options?.historyStorage;
    this.handoffQueue = options?.handoffQueue;
  }

  getHistory(): HandoffHistoryEntry[] {
    return [...this.history];
  }

  async send(packet: ContextPacket, options: SendHandoffOptions): Promise<SendHandoffResult> {
    const mode = options.mode ?? "sync";
    const timeoutSeconds = options.timeoutSeconds ?? 60;
    const createdAt = this.now().toISOString();

    const includePaths = options.include?.filter((path) => path.trim().length > 0) ?? [];
    const includeFields: ContextField[] = includePaths.map((path) => ({ path }));
    const outboundPacket: ContextPacket | IncomingContextPacket =
      includeFields.length > 0 ? createPartialPacket(packet, includeFields) : packet;

    const historyEntry: HandoffHistoryEntry = {
      id: `${packet.packetId}:${createdAt}`,
      packetId: packet.packetId,
      sourceAgent: options.sourceAgent,
      targetAgent: options.targetAgent,
      mode,
      status: "pending",
      timestamps: {
        created: createdAt,
      },
      packetSizeBytes: JSON.stringify(outboundPacket).length,
      ...(includePaths.length > 0 ? { includedFields: includePaths } : {}),
    };

    historyEntry.status = "sent";
    historyEntry.timestamps.sent = this.now().toISOString();
    await this.historyStorage?.recordSent({
      packetId: packet.packetId,
      sendingTool: packet.sendingTool,
      receivingTool: packet.receivingTool,
      taskSummary: summarizeTask(packet.task),
      sentAt: historyEntry.timestamps.sent,
    });

    if (mode === "async") {
      if (!this.handoffQueue) {
        throw new Error("handoffQueue is required for async handoff mode");
      }

      const queueRecord = await this.handoffQueue.enqueue(packet);
      historyEntry.timestamps.completed = this.now().toISOString();
      historyEntry.durationMs = this.toDurationMs(
        historyEntry.timestamps.created,
        historyEntry.timestamps.completed,
      );
      this.history.push(historyEntry);
      return { status: "sent", queueRecord, history: historyEntry };
    }

    if (!options.waitForAck) {
      throw new Error("waitForAck is required for sync handoff mode");
    }

    try {
      const ack = await waitForAckWithTimeout(options.waitForAck, packet.packetId, timeoutSeconds);
      historyEntry.timestamps.acknowledged = ack.timestamp;
      await this.historyStorage?.recordReceived({
        packetId: packet.packetId,
        eventAt: ack.timestamp,
      });
      historyEntry.timestamps.completed = this.now().toISOString();
      historyEntry.status = ack.status === "accepted" ? "acknowledged" : "rejected";
      historyEntry.durationMs = this.toDurationMs(
        historyEntry.timestamps.created,
        historyEntry.timestamps.completed,
      );
      if (ack.status === "accepted") {
        await this.historyStorage?.recordAcknowledged({
          packetId: packet.packetId,
          eventAt: ack.timestamp,
        });
      } else {
        await this.historyStorage?.recordRejected({
          packetId: packet.packetId,
          eventAt: ack.timestamp,
        });
      }
      if (ack.status === "rejected" && ack.reason) {
        historyEntry.error = ack.reason;
      }
      this.history.push(historyEntry);
      return {
        status: historyEntry.status,
        ack,
        history: historyEntry,
      };
    } catch (error) {
      if (error instanceof HandoffTimeoutError) {
        historyEntry.status = "timeout";
        historyEntry.error = error.message;
        historyEntry.timestamps.completed = this.now().toISOString();
        historyEntry.durationMs = this.toDurationMs(
          historyEntry.timestamps.created,
          historyEntry.timestamps.completed,
        );
        await this.historyStorage?.recordExpired({
          packetId: packet.packetId,
          eventAt: historyEntry.timestamps.completed,
        });
        this.history.push(historyEntry);
      }
      throw error;
    }
  }

  private toDurationMs(startIso: string, endIso?: string): number | undefined {
    if (!endIso) return undefined;
    const start = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
    return Math.max(0, end - start);
  }
}

function summarizeTask(task: Record<string, unknown>): string {
  const summaryField = task["summary"];
  if (typeof summaryField === "string" && summaryField.trim().length > 0) {
    return summaryField;
  }

  const titleField = task["title"];
  if (typeof titleField === "string" && titleField.trim().length > 0) {
    return titleField;
  }

  const typeField = task["type"];
  if (typeof typeField === "string" && typeField.trim().length > 0) {
    return typeField;
  }

  return JSON.stringify(task).slice(0, 240);
}

export async function waitForAckWithTimeout(
  waitForAck: () => Promise<HandoffAck>,
  packetId: string,
  timeoutSeconds = 60,
): Promise<HandoffAck> {
  return new Promise<HandoffAck>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new HandoffTimeoutError(packetId, timeoutSeconds));
    }, timeoutSeconds * 1000);

    void waitForAck()
      .then((ack) => {
        clearTimeout(timer);
        resolve(ack);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
