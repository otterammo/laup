/**
 * Database adapter interface (INFRA-001).
 * Provides a pluggable interface for different database backends.
 */

/**
 * Database query result.
 */
export interface QueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
  lastInsertId?: string | number;
}

/**
 * Database transaction interface.
 */
export interface Transaction {
  /** Execute a query within this transaction */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /** Commit the transaction */
  commit(): Promise<void>;

  /** Rollback the transaction */
  rollback(): Promise<void>;
}

/**
 * Database health status.
 */
export interface DbHealthStatus {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  lastCheck: number;
}

/**
 * Database connection options.
 */
export interface DbConnectionOptions {
  /** Connection string or path */
  connectionString?: string;

  /** Database file path (for SQLite) */
  filename?: string;

  /** Host (for PostgreSQL) */
  host?: string;

  /** Port (for PostgreSQL) */
  port?: number;

  /** Database name */
  database?: string;

  /** Username */
  user?: string;

  /** Password */
  password?: string;

  /** SSL mode */
  ssl?: boolean | "require" | "prefer";

  /** Connection pool size */
  poolSize?: number;

  /** Connection timeout in ms */
  connectionTimeoutMs?: number;

  /** Idle timeout in ms */
  idleTimeoutMs?: number;
}

/**
 * Database adapter interface.
 */
export interface DbAdapter {
  /** Adapter type identifier */
  readonly type: "sqlite" | "postgresql";

  /** Whether the adapter is connected */
  readonly connected: boolean;

  /**
   * Connect to the database.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the database.
   */
  disconnect(): Promise<void>;

  /**
   * Execute a query.
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  /**
   * Execute a query and return the first row.
   */
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;

  /**
   * Execute an insert/update/delete and return affected row count.
   */
  execute(sql: string, params?: unknown[]): Promise<number>;

  /**
   * Begin a transaction.
   */
  beginTransaction(): Promise<Transaction>;

  /**
   * Run a function within a transaction.
   * Automatically commits on success, rolls back on error.
   */
  withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;

  /**
   * Check database health.
   */
  healthCheck(): Promise<DbHealthStatus>;

  /**
   * Get database metadata.
   */
  getMetadata(): Promise<{
    version: string;
    tables: string[];
  }>;
}

/**
 * Base implementation with common functionality.
 */
export abstract class BaseDbAdapter implements DbAdapter {
  abstract readonly type: "sqlite" | "postgresql";
  abstract readonly connected: boolean;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  abstract execute(sql: string, params?: unknown[]): Promise<number>;
  abstract beginTransaction(): Promise<Transaction>;

  async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  async withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.beginTransaction();
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async healthCheck(): Promise<DbHealthStatus> {
    const start = Date.now();
    try {
      await this.query("SELECT 1");
      return {
        healthy: true,
        latencyMs: Date.now() - start,
        lastCheck: Date.now(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
        lastCheck: Date.now(),
      };
    }
  }

  abstract getMetadata(): Promise<{ version: string; tables: string[] }>;
}

/**
 * In-memory SQLite adapter for testing and development.
 */
export class InMemoryDbAdapter extends BaseDbAdapter {
  readonly type = "sqlite" as const;
  private _connected = false;
  private tables: Map<string, Record<string, unknown>[]> = new Map();
  private autoIncrement: Map<string, number> = new Map();

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this.tables.clear();
    this.autoIncrement.clear();
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.ensureConnected();

    // Simple SQL parsing for basic operations
    const normalized = sql.trim().toLowerCase();

    if (normalized.startsWith("select 1")) {
      return { rows: [{ "1": 1 } as T], rowCount: 1 };
    }

    if (normalized.startsWith("create table")) {
      const match = sql.match(/create table (?:if not exists\s+)?(\w+)/i);
      if (match && match[1]) {
        this.tables.set(match[1], []);
      }
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith("insert into")) {
      const match = sql.match(/insert into (\w+)/i);
      if (match && match[1]) {
        const tableName = match[1];
        const table = this.tables.get(tableName) ?? [];
        const id = (this.autoIncrement.get(tableName) ?? 0) + 1;
        this.autoIncrement.set(tableName, id);

        // Simple parameter substitution
        const row: Record<string, unknown> = { id };
        if (params) {
          const lowerSql = sql.toLowerCase();
          const valuesIdx = lowerSql.indexOf("values");
          const openParenIdx = valuesIdx > 0 ? sql.lastIndexOf("(", valuesIdx) : -1;
          const closeParenIdx =
            valuesIdx > 0 && openParenIdx >= 0 ? sql.indexOf(")", openParenIdx + 1) : -1;

          if (openParenIdx >= 0 && closeParenIdx > openParenIdx) {
            const colsRaw = sql.slice(openParenIdx + 1, closeParenIdx);
            const cols = colsRaw.split(",").map((c) => c.trim());
            cols.forEach((col, i) => {
              if (params[i] !== undefined) {
                row[col] = params[i];
              }
            });
          }
        }

        table.push(row);
        this.tables.set(tableName, table);
        return { rows: [], rowCount: 1, lastInsertId: id };
      }
    }

    if (normalized.startsWith("select")) {
      const match = sql.match(/from (\w+)/i);
      if (match && match[1]) {
        const table = this.tables.get(match[1]) ?? [];
        return { rows: table as T[], rowCount: table.length };
      }
    }

    return { rows: [], rowCount: 0 };
  }

  async execute(sql: string, params?: unknown[]): Promise<number> {
    const result = await this.query(sql, params);
    return result.rowCount;
  }

  async beginTransaction(): Promise<Transaction> {
    return {
      query: <T>(sql: string, params?: unknown[]) => this.query<T>(sql, params),
      commit: async () => {},
      rollback: async () => {},
    };
  }

  async getMetadata(): Promise<{ version: string; tables: string[] }> {
    return {
      version: "in-memory",
      tables: Array.from(this.tables.keys()),
    };
  }

  private ensureConnected(): void {
    if (!this._connected) {
      throw new Error("Database not connected");
    }
  }
}

/**
 * Create a database adapter from options.
 */
export function createDbAdapter(
  options: DbConnectionOptions & { type: "sqlite" | "postgresql" },
): DbAdapter {
  if (options.type === "sqlite") {
    // For now, return in-memory adapter
    // Real SQLite adapter would use better-sqlite3 or similar
    return new InMemoryDbAdapter();
  }

  // PostgreSQL would use pg or similar
  throw new Error(`Database type "${options.type}" not yet implemented`);
}
