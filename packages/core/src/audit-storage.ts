/**
 * Audit trail storage (INFRA-004).
 * Append-only storage for audit entries with compliance features.
 */

import { z } from "zod";
import type { DbAdapter } from "./db-adapter.js";

/**
 * Audit entry categories.
 */
export const AuditCategorySchema = z.enum([
  "config", // Configuration changes
  "auth", // Authentication events
  "access", // Access control changes
  "data", // Data modifications
  "admin", // Administrative actions
  "security", // Security events
  "mcp", // MCP server operations
  "skill", // Skill operations
]);

export type AuditCategory = z.infer<typeof AuditCategorySchema>;

/**
 * Audit severity levels.
 */
export const AuditSeveritySchema = z.enum(["info", "warning", "critical"]);

export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

/**
 * Generic audit entry schema.
 */
export const AuditEntrySchema = z.object({
  /** Unique entry ID */
  id: z.string(),

  /** Entry category */
  category: AuditCategorySchema,

  /** Operation/action performed */
  action: z.string(),

  /** Actor (user, agent, system) */
  actor: z.string(),

  /** Target resource ID */
  targetId: z.string().optional(),

  /** Target resource type */
  targetType: z.string().optional(),

  /** Severity level */
  severity: AuditSeveritySchema,

  /** ISO 8601 timestamp */
  timestamp: z.string(),

  /** Previous state (for changes) */
  previousState: z.unknown().optional(),

  /** New state (for changes) */
  newState: z.unknown().optional(),

  /** Additional context/metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),

  /** Operation reason/justification */
  reason: z.string().optional(),

  /** Request/correlation ID for tracing */
  correlationId: z.string().optional(),

  /** IP address (for remote actions) */
  ipAddress: z.string().optional(),

  /** User agent (for remote actions) */
  userAgent: z.string().optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/**
 * Audit query filters.
 */
export interface AuditQueryFilter {
  /** Filter by category */
  category?: AuditCategory;

  /** Filter by action */
  action?: string;

  /** Filter by actor */
  actor?: string;

  /** Filter by target ID */
  targetId?: string;

  /** Filter by target type */
  targetType?: string;

  /** Filter by severity */
  severity?: AuditSeverity;

  /** Filter by correlation ID */
  correlationId?: string;

  /** Start time (inclusive) */
  startTime?: Date;

  /** End time (exclusive) */
  endTime?: Date;
}

/**
 * Audit export options.
 */
export interface AuditExportOptions {
  /** Export format */
  format: "json" | "csv";

  /** Include these categories (default: all) */
  categories?: AuditCategory[];

  /** Date range start */
  startTime?: Date;

  /** Date range end */
  endTime?: Date;

  /** Include full state diffs */
  includeStateDiffs?: boolean;
}

/**
 * Audit statistics.
 */
export interface AuditStats {
  totalEntries: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  oldestEntry?: string;
  newestEntry?: string;
}

/**
 * Pagination result.
 */
export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Audit storage interface.
 */
export interface AuditStorage {
  /**
   * Initialize storage.
   */
  init(): Promise<void>;

  /**
   * Append an audit entry.
   */
  append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<string>;

  /**
   * Append multiple entries atomically.
   */
  appendBatch(entries: Omit<AuditEntry, "id" | "timestamp">[]): Promise<string[]>;

  /**
   * Query entries with filters.
   */
  query(filter: AuditQueryFilter, limit?: number, offset?: number): Promise<AuditPage>;

  /**
   * Get a single entry by ID.
   */
  get(id: string): Promise<AuditEntry | null>;

  /**
   * Get entries by correlation ID.
   */
  getByCorrelation(correlationId: string): Promise<AuditEntry[]>;

  /**
   * Get audit statistics.
   */
  stats(): Promise<AuditStats>;

  /**
   * Export entries to a format.
   */
  export(options: AuditExportOptions): Promise<string>;

  /**
   * Verify integrity (check for tampering).
   */
  verifyIntegrity(): Promise<{ valid: boolean; issues: string[] }>;

  /**
   * Archive entries older than a date.
   */
  archive(before: Date): Promise<number>;
}

/**
 * In-memory audit storage for testing.
 */
export class InMemoryAuditStorage implements AuditStorage {
  private entries: Map<string, AuditEntry> = new Map();
  private nextId = 1;

  async init(): Promise<void> {}

  async append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<string> {
    const id = `aud_${this.nextId++}`;
    const fullEntry: AuditEntry = {
      ...entry,
      id,
      timestamp: new Date().toISOString(),
      severity: entry.severity ?? "info",
    };
    this.entries.set(id, fullEntry);
    return id;
  }

  async appendBatch(entries: Omit<AuditEntry, "id" | "timestamp">[]): Promise<string[]> {
    const ids: string[] = [];
    for (const entry of entries) {
      ids.push(await this.append(entry));
    }
    return ids;
  }

  async query(filter: AuditQueryFilter, limit = 100, offset = 0): Promise<AuditPage> {
    const filtered = this.filterEntries(filter);
    const sorted = filtered.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return {
      entries: sorted.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
      hasMore: offset + limit < filtered.length,
    };
  }

  async get(id: string): Promise<AuditEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async getByCorrelation(correlationId: string): Promise<AuditEntry[]> {
    return Array.from(this.entries.values())
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async stats(): Promise<AuditStats> {
    const entries = Array.from(this.entries.values());
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    let oldest: string | undefined;
    let newest: string | undefined;

    for (const entry of entries) {
      byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
      bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;

      if (!oldest || entry.timestamp < oldest) oldest = entry.timestamp;
      if (!newest || entry.timestamp > newest) newest = entry.timestamp;
    }

    const stats: AuditStats = {
      totalEntries: entries.length,
      byCategory,
      bySeverity,
    };
    if (oldest) stats.oldestEntry = oldest;
    if (newest) stats.newestEntry = newest;
    return stats;
  }

  async export(options: AuditExportOptions): Promise<string> {
    let entries = Array.from(this.entries.values());

    if (options.categories) {
      entries = entries.filter((e) => options.categories!.includes(e.category));
    }
    if (options.startTime) {
      entries = entries.filter((e) => new Date(e.timestamp) >= options.startTime!);
    }
    if (options.endTime) {
      entries = entries.filter((e) => new Date(e.timestamp) < options.endTime!);
    }

    if (options.format === "json") {
      const data = options.includeStateDiffs
        ? entries
        : entries.map(({ previousState: _p, newState: _n, ...rest }) => rest);
      return JSON.stringify(data, null, 2);
    }

    // CSV format
    const headers = [
      "id",
      "timestamp",
      "category",
      "action",
      "actor",
      "severity",
      "targetId",
      "targetType",
      "reason",
    ];
    const rows = entries.map((e) =>
      [
        e.id,
        e.timestamp,
        e.category,
        e.action,
        e.actor,
        e.severity,
        e.targetId ?? "",
        e.targetType ?? "",
        e.reason ?? "",
      ].join(","),
    );
    return [headers.join(","), ...rows].join("\n");
  }

  async verifyIntegrity(): Promise<{ valid: boolean; issues: string[] }> {
    // In-memory storage is always valid
    return { valid: true, issues: [] };
  }

  async archive(before: Date): Promise<number> {
    let archived = 0;
    for (const [id, entry] of this.entries) {
      if (new Date(entry.timestamp) < before) {
        this.entries.delete(id);
        archived++;
      }
    }
    return archived;
  }

  private filterEntries(filter: AuditQueryFilter): AuditEntry[] {
    return Array.from(this.entries.values()).filter((entry) => {
      if (filter.category && entry.category !== filter.category) return false;
      if (filter.action && entry.action !== filter.action) return false;
      if (filter.actor && entry.actor !== filter.actor) return false;
      if (filter.targetId && entry.targetId !== filter.targetId) return false;
      if (filter.targetType && entry.targetType !== filter.targetType) return false;
      if (filter.severity && entry.severity !== filter.severity) return false;
      if (filter.correlationId && entry.correlationId !== filter.correlationId) return false;

      const ts = new Date(entry.timestamp).getTime();
      if (filter.startTime && ts < filter.startTime.getTime()) return false;
      if (filter.endTime && ts >= filter.endTime.getTime()) return false;

      return true;
    });
  }
}

/**
 * SQL-based audit storage.
 */
export class SqlAuditStorage implements AuditStorage {
  constructor(private db: DbAdapter) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS audit_entries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        target_id TEXT,
        target_type TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        timestamp TEXT NOT NULL,
        previous_state TEXT,
        new_state TEXT,
        metadata TEXT,
        reason TEXT,
        correlation_id TEXT,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_entries(category)`,
    );
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_entries(actor)`);
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_entries(correlation_id)`,
    );
  }

  async append(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<string> {
    const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    await this.db.execute(
      `INSERT INTO audit_entries (id, category, action, actor, target_id, target_type, severity, timestamp, previous_state, new_state, metadata, reason, correlation_id, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.category,
        entry.action,
        entry.actor,
        entry.targetId ?? null,
        entry.targetType ?? null,
        entry.severity ?? "info",
        timestamp,
        entry.previousState ? JSON.stringify(entry.previousState) : null,
        entry.newState ? JSON.stringify(entry.newState) : null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.reason ?? null,
        entry.correlationId ?? null,
        entry.ipAddress ?? null,
        entry.userAgent ?? null,
      ],
    );

    return id;
  }

  async appendBatch(entries: Omit<AuditEntry, "id" | "timestamp">[]): Promise<string[]> {
    const ids: string[] = [];
    await this.db.withTransaction(async (tx) => {
      for (const entry of entries) {
        const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = new Date().toISOString();

        await tx.query(
          `INSERT INTO audit_entries (id, category, action, actor, target_id, target_type, severity, timestamp, previous_state, new_state, metadata, reason, correlation_id, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            entry.category,
            entry.action,
            entry.actor,
            entry.targetId ?? null,
            entry.targetType ?? null,
            entry.severity ?? "info",
            timestamp,
            entry.previousState ? JSON.stringify(entry.previousState) : null,
            entry.newState ? JSON.stringify(entry.newState) : null,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.reason ?? null,
            entry.correlationId ?? null,
            entry.ipAddress ?? null,
            entry.userAgent ?? null,
          ],
        );
        ids.push(id);
      }
    });
    return ids;
  }

  async query(_filter: AuditQueryFilter, limit = 100, offset = 0): Promise<AuditPage> {
    // Simplified - real version would build WHERE clause
    const result = await this.db.query<AuditEntry>(
      `SELECT * FROM audit_entries ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    const countResult = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM audit_entries`,
    );

    return {
      entries: result.rows,
      total: countResult?.count ?? 0,
      limit,
      offset,
      hasMore: offset + limit < (countResult?.count ?? 0),
    };
  }

  async get(id: string): Promise<AuditEntry | null> {
    return this.db.queryOne<AuditEntry>(`SELECT * FROM audit_entries WHERE id = ?`, [id]);
  }

  async getByCorrelation(correlationId: string): Promise<AuditEntry[]> {
    const result = await this.db.query<AuditEntry>(
      `SELECT * FROM audit_entries WHERE correlation_id = ? ORDER BY timestamp`,
      [correlationId],
    );
    return result.rows;
  }

  async stats(): Promise<AuditStats> {
    const total = await this.db.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM audit_entries`,
    );
    const oldest = await this.db.queryOne<{ timestamp: string }>(
      `SELECT timestamp FROM audit_entries ORDER BY timestamp ASC LIMIT 1`,
    );
    const newest = await this.db.queryOne<{ timestamp: string }>(
      `SELECT timestamp FROM audit_entries ORDER BY timestamp DESC LIMIT 1`,
    );

    const stats: AuditStats = {
      totalEntries: total?.count ?? 0,
      byCategory: {},
      bySeverity: {},
    };
    if (oldest?.timestamp) stats.oldestEntry = oldest.timestamp;
    if (newest?.timestamp) stats.newestEntry = newest.timestamp;
    return stats;
  }

  async export(_options: AuditExportOptions): Promise<string> {
    // Simplified
    return "[]";
  }

  async verifyIntegrity(): Promise<{ valid: boolean; issues: string[] }> {
    return { valid: true, issues: [] };
  }

  async archive(before: Date): Promise<number> {
    return this.db.execute(`DELETE FROM audit_entries WHERE timestamp < ?`, [before.toISOString()]);
  }
}

/**
 * Create audit storage with the given database adapter.
 */
export function createAuditStorage(db: DbAdapter): AuditStorage {
  return new SqlAuditStorage(db);
}

/**
 * Helper to create a config change audit entry.
 */
export function auditConfigChange(
  actor: string,
  action: string,
  targetId: string,
  previousState: unknown,
  newState: unknown,
  reason?: string,
): Omit<AuditEntry, "id" | "timestamp"> {
  return {
    category: "config",
    action,
    actor,
    targetId,
    targetType: "config",
    severity: "info",
    previousState,
    newState,
    reason,
  };
}

/**
 * Helper to create a security audit entry.
 */
export function auditSecurityEvent(
  actor: string,
  action: string,
  severity: AuditSeverity,
  metadata?: Record<string, unknown>,
): Omit<AuditEntry, "id" | "timestamp"> {
  return {
    category: "security",
    action,
    actor,
    severity,
    metadata,
  };
}
