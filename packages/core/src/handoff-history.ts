import type { AuditStorage } from "./audit-storage.js";
import type { DbAdapter } from "./db-adapter.js";

export const MIN_HANDOFF_HISTORY_RETENTION_MONTHS = 24;

export type HandoffHistoryStatus = "sent" | "received" | "acknowledged" | "expired" | "rejected";

export interface HandoffHistoryRecord {
  id: string;
  packetId: string;
  sendingTool: string;
  receivingTool: string;
  taskSummary: string;
  sentAt: string;
  eventAt: string;
  status: HandoffHistoryStatus;
}

export interface HandoffHistoryQuery {
  packetId?: string;
  tool?: string;
  startTime?: Date;
  endTime?: Date;
  status?: HandoffHistoryStatus;
}

export interface HandoffRecordSentInput {
  packetId: string;
  sendingTool: string;
  receivingTool: string;
  taskSummary: string;
  sentAt?: string;
}

export interface HandoffRecordStatusInput {
  packetId: string;
  status: Exclude<HandoffHistoryStatus, "sent">;
  eventAt?: string;
  sendingTool?: string;
  receivingTool?: string;
  taskSummary?: string;
  sentAt?: string;
}

export interface HandoffHistoryStorage {
  init(): Promise<void>;
  recordSent(input: HandoffRecordSentInput): Promise<string>;
  recordReceived(input: Omit<HandoffRecordStatusInput, "status">): Promise<string>;
  recordAcknowledged(input: Omit<HandoffRecordStatusInput, "status">): Promise<string>;
  recordExpired(input: Omit<HandoffRecordStatusInput, "status">): Promise<string>;
  recordRejected(input: Omit<HandoffRecordStatusInput, "status">): Promise<string>;
  query(filter: HandoffHistoryQuery): Promise<HandoffHistoryRecord[]>;
  prune(before?: Date): Promise<number>;
}

function retentionCutoffFrom(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - MIN_HANDOFF_HISTORY_RETENTION_MONTHS,
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
}

function effectivePruneBefore(now: Date, before?: Date): Date {
  const retentionCutoff = retentionCutoffFrom(now);
  if (!before) return retentionCutoff;
  return before.getTime() < retentionCutoff.getTime() ? before : retentionCutoff;
}

function matchesFilter(record: HandoffHistoryRecord, filter: HandoffHistoryQuery): boolean {
  if (filter.packetId && record.packetId !== filter.packetId) return false;
  if (filter.status && record.status !== filter.status) return false;
  if (filter.tool && record.sendingTool !== filter.tool && record.receivingTool !== filter.tool) {
    return false;
  }

  const time = new Date(record.eventAt).getTime();
  if (filter.startTime && time < filter.startTime.getTime()) return false;
  if (filter.endTime && time >= filter.endTime.getTime()) return false;

  return true;
}

async function appendHandoffAudit(
  auditStorage: AuditStorage | undefined,
  record: HandoffHistoryRecord,
): Promise<void> {
  if (!auditStorage) return;

  await auditStorage.append({
    category: "handoff",
    action: `handoff.${record.status}`,
    actor: record.sendingTool,
    targetId: record.packetId,
    targetType: "context-packet",
    severity: "info",
    metadata: {
      packetId: record.packetId,
      sendingTool: record.sendingTool,
      receivingTool: record.receivingTool,
      taskSummary: record.taskSummary,
      sentAt: record.sentAt,
      eventAt: record.eventAt,
      status: record.status,
    },
  });
}

export class InMemoryHandoffHistoryStorage implements HandoffHistoryStorage {
  private records: HandoffHistoryRecord[] = [];
  private nextId = 1;

  constructor(
    private now: () => Date = () => new Date(),
    private auditStorage?: AuditStorage,
  ) {}

  async init(): Promise<void> {}

  async recordSent(input: HandoffRecordSentInput): Promise<string> {
    const sentAt = input.sentAt ?? this.now().toISOString();
    return this.appendRecord({
      packetId: input.packetId,
      sendingTool: input.sendingTool,
      receivingTool: input.receivingTool,
      taskSummary: input.taskSummary,
      sentAt,
      status: "sent",
      eventAt: sentAt,
    });
  }

  async recordReceived(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "received" });
  }

  async recordAcknowledged(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "acknowledged" });
  }

  async recordExpired(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "expired" });
  }

  async recordRejected(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "rejected" });
  }

  async query(filter: HandoffHistoryQuery): Promise<HandoffHistoryRecord[]> {
    return this.records
      .filter((record) => matchesFilter(record, filter))
      .sort((a, b) => a.eventAt.localeCompare(b.eventAt));
  }

  async prune(before?: Date): Promise<number> {
    const pruneBefore = effectivePruneBefore(this.now(), before);
    const pruneBeforeMs = pruneBefore.getTime();

    const keep: HandoffHistoryRecord[] = [];
    let pruned = 0;
    for (const record of this.records) {
      if (new Date(record.eventAt).getTime() < pruneBeforeMs) {
        pruned += 1;
        continue;
      }
      keep.push(record);
    }

    this.records = keep;
    return pruned;
  }

  private async recordStatus(input: HandoffRecordStatusInput): Promise<string> {
    const baseline = this.getBaseline(input.packetId);
    if (
      !baseline &&
      (!input.sendingTool || !input.receivingTool || !input.taskSummary || !input.sentAt)
    ) {
      throw new Error(
        `Missing packet context for ${input.packetId}. Provide sendingTool, receivingTool, taskSummary, and sentAt when no sent record exists.`,
      );
    }

    const eventAt = input.eventAt ?? this.now().toISOString();
    return this.appendRecord({
      packetId: input.packetId,
      sendingTool: input.sendingTool ?? baseline!.sendingTool,
      receivingTool: input.receivingTool ?? baseline!.receivingTool,
      taskSummary: input.taskSummary ?? baseline!.taskSummary,
      sentAt: input.sentAt ?? baseline!.sentAt,
      eventAt,
      status: input.status,
    });
  }

  private getBaseline(packetId: string): HandoffHistoryRecord | undefined {
    const matches = this.records.filter((record) => record.packetId === packetId);
    if (matches.length === 0) return undefined;
    return matches.reduce((latest, current) =>
      current.eventAt.localeCompare(latest.eventAt) > 0 ? current : latest,
    );
  }

  private async appendRecord(record: Omit<HandoffHistoryRecord, "id">): Promise<string> {
    const id = `handoff_hist_${this.nextId++}`;
    const fullRecord = { id, ...record };
    this.records.push(fullRecord);
    await appendHandoffAudit(this.auditStorage, fullRecord);
    return id;
  }
}

export class SqlHandoffHistoryStorage implements HandoffHistoryStorage {
  constructor(
    private db: DbAdapter,
    private now: () => Date = () => new Date(),
    private auditStorage?: AuditStorage,
  ) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS handoff_history_events (
        id TEXT PRIMARY KEY,
        packet_id TEXT NOT NULL,
        sending_tool TEXT NOT NULL,
        receiving_tool TEXT NOT NULL,
        task_summary TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        event_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_handoff_history_packet_event ON handoff_history_events(packet_id, event_at)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_handoff_history_status_event ON handoff_history_events(status, event_at)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_handoff_history_sending_tool_event ON handoff_history_events(sending_tool, event_at)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_handoff_history_receiving_tool_event ON handoff_history_events(receiving_tool, event_at)`,
    );
  }

  async recordSent(input: HandoffRecordSentInput): Promise<string> {
    const sentAt = input.sentAt ?? this.now().toISOString();
    return this.appendRecord({
      packetId: input.packetId,
      sendingTool: input.sendingTool,
      receivingTool: input.receivingTool,
      taskSummary: input.taskSummary,
      sentAt,
      status: "sent",
      eventAt: sentAt,
    });
  }

  async recordReceived(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "received" });
  }

  async recordAcknowledged(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "acknowledged" });
  }

  async recordExpired(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "expired" });
  }

  async recordRejected(input: Omit<HandoffRecordStatusInput, "status">): Promise<string> {
    return this.recordStatus({ ...input, status: "rejected" });
  }

  async query(filter: HandoffHistoryQuery): Promise<HandoffHistoryRecord[]> {
    const result = await this.db.query<{
      id: string;
      packet_id: string;
      sending_tool: string;
      receiving_tool: string;
      task_summary: string;
      sent_at: string;
      event_at: string;
      status: HandoffHistoryStatus;
    }>(`SELECT * FROM handoff_history_events ORDER BY event_at ASC`);

    return result.rows
      .map((row) => ({
        id: row.id,
        packetId: row.packet_id,
        sendingTool: row.sending_tool,
        receivingTool: row.receiving_tool,
        taskSummary: row.task_summary,
        sentAt: row.sent_at,
        eventAt: row.event_at,
        status: row.status,
      }))
      .filter((record) => matchesFilter(record, filter));
  }

  async prune(before?: Date): Promise<number> {
    const pruneBefore = effectivePruneBefore(this.now(), before).toISOString();
    return this.db.execute(`DELETE FROM handoff_history_events WHERE event_at < ?`, [pruneBefore]);
  }

  private async recordStatus(input: HandoffRecordStatusInput): Promise<string> {
    const baseline = await this.getBaseline(input.packetId);
    if (
      !baseline &&
      (!input.sendingTool || !input.receivingTool || !input.taskSummary || !input.sentAt)
    ) {
      throw new Error(
        `Missing packet context for ${input.packetId}. Provide sendingTool, receivingTool, taskSummary, and sentAt when no sent record exists.`,
      );
    }

    const eventAt = input.eventAt ?? this.now().toISOString();
    return this.appendRecord({
      packetId: input.packetId,
      sendingTool: input.sendingTool ?? baseline!.sendingTool,
      receivingTool: input.receivingTool ?? baseline!.receivingTool,
      taskSummary: input.taskSummary ?? baseline!.taskSummary,
      sentAt: input.sentAt ?? baseline!.sentAt,
      eventAt,
      status: input.status,
    });
  }

  private async getBaseline(packetId: string): Promise<HandoffHistoryRecord | undefined> {
    const row = await this.db.queryOne<{
      id: string;
      packet_id: string;
      sending_tool: string;
      receiving_tool: string;
      task_summary: string;
      sent_at: string;
      event_at: string;
      status: HandoffHistoryStatus;
    }>(`SELECT * FROM handoff_history_events WHERE packet_id = ? ORDER BY event_at DESC LIMIT 1`, [
      packetId,
    ]);

    if (!row) return undefined;
    return {
      id: row.id,
      packetId: row.packet_id,
      sendingTool: row.sending_tool,
      receivingTool: row.receiving_tool,
      taskSummary: row.task_summary,
      sentAt: row.sent_at,
      eventAt: row.event_at,
      status: row.status,
    };
  }

  private async appendRecord(record: Omit<HandoffHistoryRecord, "id">): Promise<string> {
    const id = `handoff_hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await this.db.execute(
      `INSERT INTO handoff_history_events (id, packet_id, sending_tool, receiving_tool, task_summary, sent_at, event_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        record.packetId,
        record.sendingTool,
        record.receivingTool,
        record.taskSummary,
        record.sentAt,
        record.eventAt,
        record.status,
      ],
    );

    await appendHandoffAudit(this.auditStorage, { id, ...record });

    return id;
  }
}

export function createHandoffHistoryStorage(
  db: DbAdapter,
  auditStorage?: AuditStorage,
): HandoffHistoryStorage {
  return new SqlHandoffHistoryStorage(db, undefined, auditStorage);
}
