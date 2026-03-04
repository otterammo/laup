/**
 * Immutable append-only skill installation and usage history (SKILL-011).
 */

import type { DbAdapter } from "./db-adapter.js";

export const MIN_SKILL_HISTORY_RETENTION_MONTHS = 24;

export type SkillHistoryEventType = "install" | "usage";

interface SkillHistoryEventBase {
  id: string;
  type: SkillHistoryEventType;
  skillId: string;
  projectId: string;
  timestamp: string;
}

export interface SkillInstallHistoryEvent extends SkillHistoryEventBase {
  type: "install";
  version: string;
  actor: string;
}

export interface SkillUsageHistoryEvent extends SkillHistoryEventBase {
  type: "usage";
  invocationCount: number;
}

export type SkillHistoryEvent = SkillInstallHistoryEvent | SkillUsageHistoryEvent;

export interface SkillHistoryQuery {
  skillId?: string;
  projectId?: string;
  startTime?: Date;
  endTime?: Date;
  type?: SkillHistoryEventType;
}

export interface RecordSkillInstallInput {
  skillId: string;
  projectId: string;
  version: string;
  actor: string;
  timestamp?: string;
}

export interface RecordSkillUsageInput {
  skillId: string;
  projectId: string;
  invocationCount?: number;
  timestamp?: string;
}

export interface SkillHistoryStorage {
  init(): Promise<void>;
  recordInstall(input: RecordSkillInstallInput): Promise<string>;
  recordUsage(input: RecordSkillUsageInput): Promise<string>;
  query(filter: SkillHistoryQuery): Promise<SkillHistoryEvent[]>;
  prune(before?: Date): Promise<number>;
}

function retentionCutoffFrom(now: Date): Date {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - MIN_SKILL_HISTORY_RETENTION_MONTHS,
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

export class InMemorySkillHistoryStorage implements SkillHistoryStorage {
  private events: SkillHistoryEvent[] = [];
  private nextId = 1;

  constructor(private now: () => Date = () => new Date()) {}

  async init(): Promise<void> {}

  async recordInstall(input: RecordSkillInstallInput): Promise<string> {
    const id = `skill_hist_${this.nextId++}`;
    this.events.push({
      id,
      type: "install",
      skillId: input.skillId,
      projectId: input.projectId,
      version: input.version,
      actor: input.actor,
      timestamp: input.timestamp ?? this.now().toISOString(),
    });
    return id;
  }

  async recordUsage(input: RecordSkillUsageInput): Promise<string> {
    const id = `skill_hist_${this.nextId++}`;
    this.events.push({
      id,
      type: "usage",
      skillId: input.skillId,
      projectId: input.projectId,
      invocationCount: input.invocationCount ?? 1,
      timestamp: input.timestamp ?? this.now().toISOString(),
    });
    return id;
  }

  async query(filter: SkillHistoryQuery): Promise<SkillHistoryEvent[]> {
    return this.events
      .filter((event) => {
        if (filter.type && event.type !== filter.type) return false;
        if (filter.skillId && event.skillId !== filter.skillId) return false;
        if (filter.projectId && event.projectId !== filter.projectId) return false;

        const eventTime = new Date(event.timestamp).getTime();
        if (filter.startTime && eventTime < filter.startTime.getTime()) return false;
        if (filter.endTime && eventTime >= filter.endTime.getTime()) return false;

        return true;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async prune(before?: Date): Promise<number> {
    const pruneBefore = effectivePruneBefore(this.now(), before);
    const pruneBeforeMs = pruneBefore.getTime();

    const keep: SkillHistoryEvent[] = [];
    let pruned = 0;
    for (const event of this.events) {
      if (new Date(event.timestamp).getTime() < pruneBeforeMs) {
        pruned += 1;
        continue;
      }
      keep.push(event);
    }

    this.events = keep;
    return pruned;
  }
}

export class SqlSkillHistoryStorage implements SkillHistoryStorage {
  constructor(
    private db: DbAdapter,
    private now: () => Date = () => new Date(),
  ) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS skill_history_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        version TEXT,
        actor TEXT,
        invocation_count INTEGER,
        timestamp TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_skill_history_skill_timestamp ON skill_history_events(skill_id, timestamp)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_skill_history_project_timestamp ON skill_history_events(project_id, timestamp)`,
    );
  }

  async recordInstall(input: RecordSkillInstallInput): Promise<string> {
    const id = `skill_hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.db.execute(
      `INSERT INTO skill_history_events (id, type, skill_id, project_id, version, actor, invocation_count, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        "install",
        input.skillId,
        input.projectId,
        input.version,
        input.actor,
        null,
        input.timestamp ?? this.now().toISOString(),
      ],
    );
    return id;
  }

  async recordUsage(input: RecordSkillUsageInput): Promise<string> {
    const id = `skill_hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await this.db.execute(
      `INSERT INTO skill_history_events (id, type, skill_id, project_id, version, actor, invocation_count, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        "usage",
        input.skillId,
        input.projectId,
        null,
        null,
        input.invocationCount ?? 1,
        input.timestamp ?? this.now().toISOString(),
      ],
    );
    return id;
  }

  async query(filter: SkillHistoryQuery): Promise<SkillHistoryEvent[]> {
    const result = await this.db.query<{
      id: string;
      type: SkillHistoryEventType;
      skill_id: string;
      project_id: string;
      version: string | null;
      actor: string | null;
      invocation_count: number | null;
      timestamp: string;
    }>(`SELECT * FROM skill_history_events ORDER BY timestamp ASC`);

    return result.rows
      .filter((row) => {
        if (filter.type && row.type !== filter.type) return false;
        if (filter.skillId && row.skill_id !== filter.skillId) return false;
        if (filter.projectId && row.project_id !== filter.projectId) return false;

        const eventTime = new Date(row.timestamp).getTime();
        if (filter.startTime && eventTime < filter.startTime.getTime()) return false;
        if (filter.endTime && eventTime >= filter.endTime.getTime()) return false;

        return true;
      })
      .map((row) => {
        if (row.type === "install") {
          return {
            id: row.id,
            type: "install",
            skillId: row.skill_id,
            projectId: row.project_id,
            version: row.version ?? "",
            actor: row.actor ?? "",
            timestamp: row.timestamp,
          } satisfies SkillInstallHistoryEvent;
        }

        return {
          id: row.id,
          type: "usage",
          skillId: row.skill_id,
          projectId: row.project_id,
          invocationCount: row.invocation_count ?? 1,
          timestamp: row.timestamp,
        } satisfies SkillUsageHistoryEvent;
      });
  }

  async prune(before?: Date): Promise<number> {
    const pruneBefore = effectivePruneBefore(this.now(), before).toISOString();
    return this.db.execute(`DELETE FROM skill_history_events WHERE timestamp < ?`, [pruneBefore]);
  }
}

export function createSkillHistoryStorage(db: DbAdapter): SkillHistoryStorage {
  return new SqlSkillHistoryStorage(db);
}
