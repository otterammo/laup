import type {
  ContextPacket,
  HandoffAck,
  HandoffHistoryEntry,
  HandoffMode,
} from "./handoff-schema.js";

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
}

export interface SendHandoffResult {
  status: "sent" | "acknowledged" | "rejected";
  ack?: HandoffAck;
  history: HandoffHistoryEntry;
}

export class HandoffManager {
  private readonly history: HandoffHistoryEntry[] = [];
  private readonly now: () => Date;

  constructor(options?: { now?: () => Date }) {
    this.now = options?.now ?? (() => new Date());
  }

  getHistory(): HandoffHistoryEntry[] {
    return [...this.history];
  }

  async send(packet: ContextPacket, options: SendHandoffOptions): Promise<SendHandoffResult> {
    const mode = options.mode ?? "sync";
    const timeoutSeconds = options.timeoutSeconds ?? 60;
    const createdAt = this.now().toISOString();

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
      packetSizeBytes: JSON.stringify(packet).length,
    };

    historyEntry.status = "sent";
    historyEntry.timestamps.sent = this.now().toISOString();

    if (mode === "async") {
      historyEntry.timestamps.completed = this.now().toISOString();
      historyEntry.durationMs = this.toDurationMs(
        historyEntry.timestamps.created,
        historyEntry.timestamps.completed,
      );
      this.history.push(historyEntry);
      return { status: "sent", history: historyEntry };
    }

    if (!options.waitForAck) {
      throw new Error("waitForAck is required for sync handoff mode");
    }

    try {
      const ack = await waitForAckWithTimeout(options.waitForAck, packet.packetId, timeoutSeconds);
      historyEntry.timestamps.acknowledged = ack.timestamp;
      historyEntry.timestamps.completed = this.now().toISOString();
      historyEntry.status = ack.status === "accepted" ? "acknowledged" : "rejected";
      historyEntry.durationMs = this.toDurationMs(
        historyEntry.timestamps.created,
        historyEntry.timestamps.completed,
      );
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
