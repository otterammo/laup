/**
 * Usage event storage (INFRA-003).
 * Persistent storage for usage events with time-series queries.
 */

import type { LlmUsage, UsageAttribution, UsageEvent } from "./cost-schema.js";
import type { DbAdapter } from "./db-adapter.js";

export type TimeBucket = "hour" | "day" | "week" | "month";

export interface UsageQueryFilter {
  developerId?: string;
  /** @deprecated Use developerId */
  userId?: string;
  teamId?: string;
  projectId?: string;
  orgId?: string;
  eventType?: string;
  model?: string;
  skillId?: string;
  adapterId?: string;
  toolCategory?: string;
  sessionId?: string;
  costCenter?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface AggregatedUsage {
  bucket: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
}

export interface UsageSummary {
  dimension: string;
  value: string;
  totalTokens: number;
  eventCount: number;
}

export interface MultiDimensionUsageSummary {
  dimensions: Record<string, string>;
  totalTokens: number;
  eventCount: number;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface UsageStorage {
  init(): Promise<void>;
  store(event: UsageEvent): Promise<string>;
  storeBatch(events: UsageEvent[]): Promise<string[]>;
  query(
    filter: UsageQueryFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<UsageEvent>>;
  aggregate(filter: UsageQueryFilter, bucket: TimeBucket): Promise<AggregatedUsage[]>;
  summarize(filter: UsageQueryFilter, dimension: keyof UsageAttribution): Promise<UsageSummary[]>;
  summarizeByDeveloper(filter: UsageQueryFilter): Promise<UsageSummary[]>;
  summarizeByTeam(filter: UsageQueryFilter): Promise<UsageSummary[]>;
  summarizeByProject(filter: UsageQueryFilter): Promise<UsageSummary[]>;
  summarizeBySkill(filter: UsageQueryFilter): Promise<UsageSummary[]>;
  summarizeByDimensions(
    filter: UsageQueryFilter,
    dimensions: (keyof UsageAttribution)[],
  ): Promise<MultiDimensionUsageSummary[]>;
  prune(before: Date): Promise<number>;
  count(filter?: UsageQueryFilter): Promise<number>;
}

function getLlmUsage(event: UsageEvent): LlmUsage | null {
  return event.type === "llm-call" ? (event.data as LlmUsage) : null;
}

function getAttributionValue(event: UsageEvent, dimension: keyof UsageAttribution): string {
  if (dimension === "developerId") {
    return event.attribution.developerId ?? event.attribution.userId ?? "unknown";
  }
  if (dimension === "userId") {
    return event.attribution.userId ?? event.attribution.developerId ?? "unknown";
  }
  if (dimension === "skillId") {
    return (
      event.attribution.skillId ??
      (event.type === "skill-invocation"
        ? (event.data as { skillId: string }).skillId
        : undefined) ??
      "unknown"
    );
  }

  return String(event.attribution[dimension] ?? "unknown");
}

export class InMemoryUsageStorage implements UsageStorage {
  private events = new Map<string, UsageEvent>();
  private nextId = 1;

  async init(): Promise<void> {}

  async store(event: UsageEvent): Promise<string> {
    const id = `evt_${this.nextId++}`;
    this.events.set(id, { ...event, id });
    return id;
  }

  async storeBatch(events: UsageEvent[]): Promise<string[]> {
    const ids: string[] = [];
    for (const event of events) ids.push(await this.store(event));
    return ids;
  }

  async query(
    filter: UsageQueryFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<UsageEvent>> {
    const filtered = this.filterEvents(filter);
    const limit = pagination?.limit ?? 100;
    const offset = pagination?.offset ?? 0;
    return {
      data: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + limit < filtered.length,
    };
  }

  async aggregate(filter: UsageQueryFilter, bucket: TimeBucket): Promise<AggregatedUsage[]> {
    const filtered = this.filterEvents(filter);
    const buckets = new Map<string, AggregatedUsage>();

    for (const event of filtered) {
      const bucketKey = this.getBucketKey(new Date(event.timestamp), bucket);
      const existing = buckets.get(bucketKey) ?? {
        bucket: bucketKey,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        eventCount: 0,
      };

      const llmUsage = getLlmUsage(event);
      if (llmUsage) {
        existing.inputTokens += llmUsage.inputTokens;
        existing.outputTokens += llmUsage.outputTokens;
        existing.totalTokens += llmUsage.inputTokens + llmUsage.outputTokens;
      }
      existing.eventCount += 1;
      buckets.set(bucketKey, existing);
    }

    return Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
  }

  async summarize(
    filter: UsageQueryFilter,
    dimension: keyof UsageAttribution,
  ): Promise<UsageSummary[]> {
    const filtered = this.filterEvents(filter);
    const summaries = new Map<string, UsageSummary>();

    for (const event of filtered) {
      const value = getAttributionValue(event, dimension);
      const existing = summaries.get(value) ?? { dimension, value, totalTokens: 0, eventCount: 0 };
      const llmUsage = getLlmUsage(event);
      if (llmUsage) existing.totalTokens += llmUsage.inputTokens + llmUsage.outputTokens;
      existing.eventCount += 1;
      summaries.set(value, existing);
    }

    return Array.from(summaries.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  }

  async summarizeByDeveloper(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "developerId");
  }
  async summarizeByTeam(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "teamId");
  }
  async summarizeByProject(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "projectId");
  }
  async summarizeBySkill(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "skillId");
  }

  async summarizeByDimensions(
    filter: UsageQueryFilter,
    dimensions: (keyof UsageAttribution)[],
  ): Promise<MultiDimensionUsageSummary[]> {
    const filtered = this.filterEvents(filter);
    const summaries = new Map<string, MultiDimensionUsageSummary>();

    for (const event of filtered) {
      const dimensionValues = Object.fromEntries(
        dimensions.map((dimension) => [dimension, getAttributionValue(event, dimension)]),
      ) as Record<string, string>;
      const key = dimensions.map((dimension) => dimensionValues[String(dimension)]).join("::");

      const existing = summaries.get(key) ?? {
        dimensions: dimensionValues,
        totalTokens: 0,
        eventCount: 0,
      };
      const llmUsage = getLlmUsage(event);
      if (llmUsage) existing.totalTokens += llmUsage.inputTokens + llmUsage.outputTokens;
      existing.eventCount += 1;
      summaries.set(key, existing);
    }

    return Array.from(summaries.values()).sort((a, b) => b.totalTokens - a.totalTokens);
  }

  async prune(before: Date): Promise<number> {
    let pruned = 0;
    const beforeTime = before.getTime();
    for (const [id, event] of this.events) {
      if (new Date(event.timestamp).getTime() < beforeTime) {
        this.events.delete(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  async count(filter?: UsageQueryFilter): Promise<number> {
    return filter ? this.filterEvents(filter).length : this.events.size;
  }

  private filterEvents(filter: UsageQueryFilter): UsageEvent[] {
    return Array.from(this.events.values()).filter((event) => {
      const eventDeveloperId = event.attribution.developerId ?? event.attribution.userId;
      if (filter.developerId && eventDeveloperId !== filter.developerId) return false;
      if (filter.userId && eventDeveloperId !== filter.userId) return false;
      if (filter.teamId && event.attribution.teamId !== filter.teamId) return false;
      if (filter.projectId && event.attribution.projectId !== filter.projectId) return false;
      if (filter.orgId && event.attribution.orgId !== filter.orgId) return false;
      if (filter.eventType && event.type !== filter.eventType) return false;
      if (filter.model) {
        const llmUsage = getLlmUsage(event);
        if (!llmUsage || llmUsage.model !== filter.model) return false;
      }
      if (filter.skillId && event.attribution.skillId !== filter.skillId) return false;
      if (filter.adapterId && event.attribution.adapterId !== filter.adapterId) return false;
      if (filter.toolCategory && event.attribution.toolCategory !== filter.toolCategory)
        return false;
      if (filter.sessionId && event.attribution.sessionId !== filter.sessionId) return false;
      if (filter.costCenter && event.attribution.costCenter !== filter.costCenter) return false;

      const eventTime = new Date(event.timestamp).getTime();
      if (filter.startTime && eventTime < filter.startTime.getTime()) return false;
      if (filter.endTime && eventTime >= filter.endTime.getTime()) return false;
      return true;
    });
  }

  private getBucketKey(date: Date, bucket: TimeBucket): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");

    switch (bucket) {
      case "hour":
        return `${year}-${month}-${day}T${hour}:00`;
      case "day":
        return `${year}-${month}-${day}`;
      case "week": {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return `${weekStart.getFullYear()}-W${String(Math.ceil((weekStart.getDate() + 1) / 7)).padStart(2, "0")}`;
      }
      case "month":
        return `${year}-${month}`;
    }
  }
}

export class SqlUsageStorage implements UsageStorage {
  constructor(private db: DbAdapter) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        user_id TEXT,
        developer_id TEXT,
        team_id TEXT,
        project_id TEXT,
        org_id TEXT,
        skill_id TEXT,
        session_id TEXT,
        adapter_id TEXT,
        tool_category TEXT,
        cost_center TEXT,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_events(timestamp)`,
    );
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id)`);
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_usage_developer ON usage_events(developer_id)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_events(project_id)`,
    );
  }

  async store(event: UsageEvent): Promise<string> {
    const id = event.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await this.db.execute(
      `INSERT INTO usage_events (id, type, timestamp, user_id, developer_id, team_id, project_id, org_id, skill_id, session_id, adapter_id, tool_category, cost_center, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        event.type,
        event.timestamp,
        event.attribution.userId ?? null,
        event.attribution.developerId ?? event.attribution.userId ?? null,
        event.attribution.teamId ?? null,
        event.attribution.projectId ?? null,
        event.attribution.orgId ?? null,
        event.attribution.skillId ?? null,
        event.attribution.sessionId ?? null,
        event.attribution.adapterId ?? null,
        event.attribution.toolCategory ?? null,
        event.attribution.costCenter ?? null,
        JSON.stringify(event.data),
      ],
    );

    return id;
  }

  async storeBatch(events: UsageEvent[]): Promise<string[]> {
    const ids: string[] = [];
    await this.db.withTransaction(async (tx) => {
      for (const event of events) {
        const id = event.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await tx.query(
          `INSERT INTO usage_events (id, type, timestamp, user_id, developer_id, team_id, project_id, org_id, skill_id, session_id, adapter_id, tool_category, cost_center, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            event.type,
            event.timestamp,
            event.attribution.userId ?? null,
            event.attribution.developerId ?? event.attribution.userId ?? null,
            event.attribution.teamId ?? null,
            event.attribution.projectId ?? null,
            event.attribution.orgId ?? null,
            event.attribution.skillId ?? null,
            event.attribution.sessionId ?? null,
            event.attribution.adapterId ?? null,
            event.attribution.toolCategory ?? null,
            event.attribution.costCenter ?? null,
            JSON.stringify(event.data),
          ],
        );
        ids.push(id);
      }
    });
    return ids;
  }

  async query(
    _filter: UsageQueryFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<UsageEvent>> {
    const limit = pagination?.limit ?? 100;
    const offset = pagination?.offset ?? 0;

    const result = await this.db.query<{ id: string }>(
      `SELECT * FROM usage_events ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    const countResult = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM usage_events`,
    );
    const total = countResult?.count ?? 0;

    return {
      data: result.rows as unknown as UsageEvent[],
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async aggregate(_filter: UsageQueryFilter, _bucket: TimeBucket): Promise<AggregatedUsage[]> {
    return [];
  }

  async summarize(
    _filter: UsageQueryFilter,
    _dimension: keyof UsageAttribution,
  ): Promise<UsageSummary[]> {
    return [];
  }

  async summarizeByDeveloper(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "developerId");
  }
  async summarizeByTeam(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "teamId");
  }
  async summarizeByProject(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "projectId");
  }
  async summarizeBySkill(filter: UsageQueryFilter): Promise<UsageSummary[]> {
    return this.summarize(filter, "skillId");
  }

  async summarizeByDimensions(
    _filter: UsageQueryFilter,
    _dimensions: (keyof UsageAttribution)[],
  ): Promise<MultiDimensionUsageSummary[]> {
    return [];
  }

  async prune(before: Date): Promise<number> {
    return this.db.execute(`DELETE FROM usage_events WHERE timestamp < ?`, [before.toISOString()]);
  }

  async count(_filter?: UsageQueryFilter): Promise<number> {
    const result = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM usage_events`,
    );
    return result?.count ?? 0;
  }
}

export function createUsageStorage(db: DbAdapter): UsageStorage {
  return new SqlUsageStorage(db);
}
