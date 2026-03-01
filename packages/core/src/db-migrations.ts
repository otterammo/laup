/**
 * Database migration system (INFRA-002).
 * Forward-only schema migrations with version tracking.
 */

import type { DbAdapter } from "./db-adapter.js";

/**
 * Migration definition.
 */
export interface Migration {
  /** Unique version identifier (e.g., "001", "002_add_users") */
  version: string;

  /** Human-readable description */
  description: string;

  /** SQL to execute for this migration */
  up: string;

  /** Optional rollback SQL (best-effort, not always possible) */
  down?: string;
}

/**
 * Migration status.
 */
export interface MigrationStatus {
  version: string;
  description: string;
  appliedAt: string;
  checksum: string;
}

/**
 * Migration result.
 */
export interface MigrationResult {
  success: boolean;
  applied: string[];
  pending: string[];
  error?: string;
}

/**
 * Migration dry-run result.
 */
export interface MigrationDryRunResult {
  pending: Array<{
    version: string;
    description: string;
    sql: string;
  }>;
  alreadyApplied: string[];
}

/**
 * Compute a simple checksum for migration SQL.
 */
export function computeChecksum(sql: string): string {
  let hash = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Database migrator.
 */
export class Migrator {
  private migrations: Migration[] = [];
  private tableName = "_migrations";

  constructor(private db: DbAdapter) {}

  /**
   * Register migrations.
   */
  register(migrations: Migration[]): void {
    this.migrations = migrations.sort((a, b) => a.version.localeCompare(b.version));
  }

  /**
   * Initialize the migrations table.
   */
  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      )
    `);
  }

  /**
   * Get applied migrations.
   */
  async getApplied(): Promise<MigrationStatus[]> {
    const result = await this.db.query<{
      version: string;
      description: string;
      applied_at: string;
      checksum: string;
    }>(`SELECT version, description, applied_at, checksum FROM ${this.tableName} ORDER BY version`);

    return result.rows.map((row) => ({
      version: row.version,
      description: row.description,
      appliedAt: row.applied_at,
      checksum: row.checksum,
    }));
  }

  /**
   * Get pending migrations.
   */
  async getPending(): Promise<Migration[]> {
    const applied = await this.getApplied();
    const appliedVersions = new Set(applied.map((m) => m.version));
    return this.migrations.filter((m) => !appliedVersions.has(m.version));
  }

  /**
   * Run a dry-run to see what would be applied.
   */
  async dryRun(): Promise<MigrationDryRunResult> {
    const applied = await this.getApplied();
    const appliedVersions = new Set(applied.map((m) => m.version));

    const pending = this.migrations
      .filter((m) => !appliedVersions.has(m.version))
      .map((m) => ({
        version: m.version,
        description: m.description,
        sql: m.up,
      }));

    return {
      pending,
      alreadyApplied: applied.map((m) => m.version),
    };
  }

  /**
   * Apply all pending migrations.
   */
  async migrate(): Promise<MigrationResult> {
    await this.init();

    const pending = await this.getPending();
    const applied: string[] = [];

    for (const migration of pending) {
      try {
        await this.applyMigration(migration);
        applied.push(migration.version);
      } catch (error) {
        return {
          success: false,
          applied,
          pending: pending.slice(applied.length).map((m) => m.version),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      success: true,
      applied,
      pending: [],
    };
  }

  /**
   * Apply a single migration.
   */
  private async applyMigration(migration: Migration): Promise<void> {
    const checksum = computeChecksum(migration.up);
    const now = new Date().toISOString();

    await this.db.withTransaction(async (tx) => {
      // Execute migration SQL
      await tx.query(migration.up);

      // Record the migration
      await tx.query(
        `INSERT INTO ${this.tableName} (version, description, applied_at, checksum) VALUES (?, ?, ?, ?)`,
        [migration.version, migration.description, now, checksum],
      );
    });
  }

  /**
   * Rollback the last migration (if rollback SQL is available).
   */
  async rollbackLast(): Promise<{ success: boolean; version?: string; error?: string }> {
    const applied = await this.getApplied();
    if (applied.length === 0) {
      return { success: false, error: "No migrations to rollback" };
    }

    const lastApplied = applied[applied.length - 1];
    if (!lastApplied) {
      return { success: false, error: "No migrations to rollback" };
    }

    const migration = this.migrations.find((m) => m.version === lastApplied.version);
    if (!migration?.down) {
      return {
        success: false,
        version: lastApplied.version,
        error: "Migration does not support rollback",
      };
    }

    try {
      await this.db.withTransaction(async (tx) => {
        await tx.query(migration.down!);
        await tx.query(`DELETE FROM ${this.tableName} WHERE version = ?`, [migration.version]);
      });

      return { success: true, version: migration.version };
    } catch (error) {
      return {
        success: false,
        version: migration.version,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate that applied migrations match registered migrations.
   */
  async validate(): Promise<{ valid: boolean; issues: string[] }> {
    const applied = await this.getApplied();
    const issues: string[] = [];

    for (const status of applied) {
      const migration = this.migrations.find((m) => m.version === status.version);

      if (!migration) {
        issues.push(`Applied migration "${status.version}" is not registered`);
        continue;
      }

      const expectedChecksum = computeChecksum(migration.up);
      if (status.checksum !== expectedChecksum) {
        issues.push(
          `Migration "${status.version}" checksum mismatch (file modified after application)`,
        );
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}

/**
 * Create a migrator with the given migrations.
 */
export function createMigrator(db: DbAdapter, migrations: Migration[]): Migrator {
  const migrator = new Migrator(db);
  migrator.register(migrations);
  return migrator;
}
