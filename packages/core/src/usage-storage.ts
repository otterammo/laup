/**
 * Usage event storage (INFRA-003).
 * Persistent storage for usage events with time-series queries.
 */

import type { LlmUsage, UsageAttribution, UsageEvent } from "./cost-schema.js";
import type { DbAdapter } from "./db-adapter.js";

/**
 * Time bucket for aggregation.
 */
export type TimeBucket = "hour" | "day" | "week" | "month";

/**
 * Usage query filters.
 */
export interface UsageQueryFilter {
  /** Filter by developer ID */
  developerId?: string;

  /** @deprecated Use developerId */
  userId?: string;

  /** Filter by team ID */
  teamId?: string;

  /** Filter by project ID */
  projectId?: string;

  /** Filter by org ID */
  orgId?: string;

  /** Filter by event type */
  eventType?: string;

  /** Filter by model */
  model?: string;

  /** Filter by skill ID */
  skillId?: string;

  /** Filter by adapter ID */
  adapterId?: string;

  /** Filter by tool category */
  toolCategory?: string;

  /** Start time (inclusive) */
  startTime?: Date;

  /** End time (exclusive) */
  endTime?: Date;
}

/**
 * Aggregated usage result.
 */
export interface AggregatedUsage {
  bucket: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
}

/**
 * Usage summary by dimension.
 */
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

/**
 * Pagination options.
 */
export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

/**
 * Paginated result.
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Usage event storage interface.
 */
export interface UsageStorage {
  /**
   * Initialize storage (create tables, indexes).
   */
  init(): Promise<void>;

  /**
   * Store a usage event.
   */
  store(event: UsageEvent): Promise<string>;

  /**
   * Store multiple events in batch.
   */
  storeBatch(events: UsageEvent[]): Promise<string[]>;

  /**
   * Query events with filters and pagination.
   */
  query(
    filter: UsageQueryFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<UsageEvent>>;

  /**
   * Get aggregated usage by time bucket.
   */
  aggregate(filter: UsageQueryFilter, bucket: TimeBucket): Promise<AggregatedUsage[]>;

  /**
   * Get usage summary grouped by dimension.
   */
  summarize(filter: UsageQueryFilter, dimension: keyof UsageAttribution): Promise<UsageSummary[]>;

  /**
   * Get usage summary grouped by multiple dimensions.
   */
  summarizeByDimensions(
    filter: UsageQueryFilter,
    dimensions: (keyof UsageAttribution)[],
  ): Promise<MultiDimensionUsageSummary[]>;

  /**
   * Delete events older than a given date.
   */
  prune(before: Date): Promise<number>;

  /**
   * Get total event count.
   */
  count(filter?: UsageQueryFilter): Promise<number>;
}

/**
 * Helper to check if event is LLM type and get usage data.
 */
function getLlmUsage(event: UsageEvent): LlmUsage | null {
  if (event.type === "llm-call") {
    return event.data as LlmUsage;
  }
  return null;
}

function getAttributionValue(event: UsageEvent, dimension: keyof UsageAttribution): string {
  if (dimension === "developerId") {
    return event.attribution.developerId ?? event.attribution.userId ?? "unknown";
  }

  if (dimension === "userId") {
    return event.attribution.userId ?? event.attribution.developerId ?? "unknown";
  }

  return String(event.attribution[dimension] ?? "unknown");
}

/**
 * In-memory usage storage for testing.
 */
export class InMemoryUsageStorage implements UsageStorage {
  private events: Map<string, UsageEvent> = new Map();
  private nextId = 1;

  async init(): Promise<void> {
    // No-op for in-memory
  }

  async store(event: UsageEvent): Promise<string> {
    const id = `evt_${this.nextId++}`;
    this.events.set(id, { ...event, id });
    return id;
  }

  async storeBatch(events: UsageEvent[]): Promise<string[]> {
    const ids: string[] = [];
    for (const event of events) {
      ids.push(await this.store(event));
    }
    return ids;
  }

  async query(
    filter: UsageQueryFilter,
    pagination?: PaginationOptions,
  ): Promise<PaginatedResult<UsageEvent>> {
    const filtered = this.filterEvents(filter);
    const limit = pagination?.limit ?? 100;
    const offset = pagination?.offset ?? 0;

    const data = filtered.slice(offset, offset + limit);

    return {
      data,
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
      existing.eventCount++;

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
      const existing = summaries.get(value) ?? {
        dimension,
        value,
        totalTokens: 0,
        eventCount: 0,
      };

      const llmUsage = getLlmUsage(event);
      if (llmUsage) {
        existing.totalTokens += llmUsage.inputTokens + llmUsage.outputTokens;
      }
      existing.eventCount++;

      summaries.set(value, existing);
    }

    return Array.from(summaries.values()).sort((a, b) => b.totalTokens - a.totalTokens);
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
      if (llmUsage) {
        existing.totalTokens += llmUsage.inputTokens + llmUsage.outputTokens;
      }
      existing.eventCount++;

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
        pruned++;
      }
    }

    return pruned;
  }

  async count(filter?: UsageQueryFilter): Promise<number> {
    if (!filter) return this.events.size;
    return this.filterEvents(filter).length;
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
      if (filter.toolCategory && event.attribution.toolCategory !== filter.toolCategory) {
        return false;
      }

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
        const ws = weekStart;
        return `${ws.getFullYear()}-W${String(Math.ceil((ws.getDate() + 1) / 7)).padStart(2, "0")}`;
      }
      case "month":
        return `${year}-${month}`;
    }
  }
}

/**
 * SQL-based usage storage.
 */
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
        adapter_id TEXT,
        tool_category TEXT,
        cost_center TEXT,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Indexes for common queries
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
      `INSERT INTO usage_events (id, type, timestamp, user_id, developer_id, team_id, project_id, org_id, skill_id, adapter_id, tool_category, cost_center, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          `INSERT INTO usage_events (id, type, timestamp, user_id, developer_id, team_id, project_id, org_id, skill_id, adapter_id, tool_category, cost_center, data)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    // Simplified implementation - real version would build WHERE clause from filter
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
    // Simplified - real version would use date functions for bucketing
    return [];
  }

  async summarize(
    _filter: UsageQueryFilter,
    _dimension: keyof UsageAttribution,
  ): Promise<UsageSummary[]> {
    // Simplified - real version would GROUP BY dimension
    return [];
  }

  async summarizeByDimensions(
    _filter: UsageQueryFilter,
    _dimensions: (keyof UsageAttribution)[],
  ): Promise<MultiDimensionUsageSummary[]> {
    // Simplified - real version would GROUP BY combined dimensions
    return [];
  }

  async prune(before: Date): Promise<number> {
    const result = await this.db.execute(`DELETE FROM usage_events WHERE timestamp < ?`, [
      before.toISOString(),
    ]);
    return result;
  }

  async count(_filter?: UsageQueryFilter): Promise<number> {
    const result = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM usage_events`,
    );
    return result?.count ?? 0;
  }
}

/**
 * Create usage storage with the given database adapter.
 */
export function createUsageStorage(db: DbAdapter): UsageStorage {
  return new SqlUsageStorage(db);
}
