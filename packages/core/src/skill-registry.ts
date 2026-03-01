/**
 * Skill registry persistence (INFRA-006).
 * Persistent storage for installed skills with version tracking.
 */

import type { DbAdapter } from "./db-adapter.js";
import type { SkillVisibility } from "./skill-schema.js";
import type { SemanticVersion, VersionConstraint } from "./skill-version.js";
import { satisfiesConstraint } from "./skill-version.js";

/**
 * Serialize a SemanticVersion to string.
 */
function versionToString(v: SemanticVersion): string {
  let str = `${v.major}.${v.minor}.${v.patch}`;
  if (v.prerelease) str += `-${v.prerelease}`;
  return str;
}

/**
 * Compare two SemanticVersion objects.
 */
function compareSemanticVersions(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  // Pre-release versions have lower precedence
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) {
    return a.prerelease.localeCompare(b.prerelease);
  }

  return 0;
}

/**
 * Skill installation status.
 */
export type SkillInstallStatus = "installed" | "pending" | "disabled" | "failed";

/**
 * Installed skill record.
 */
export interface InstalledSkill {
  /** Skill ID (namespace/name format) */
  id: string;

  /** Installed version */
  version: SemanticVersion;

  /** Installation status */
  status: SkillInstallStatus;

  /** Source URL or path */
  source: string;

  /** Checksum of installed files */
  checksum?: string;

  /** Installation timestamp */
  installedAt: string;

  /** Last update timestamp */
  updatedAt?: string;

  /** Who installed it */
  installedBy: string;

  /** Scope (project, team, org) */
  scope: string;

  /** Scope type */
  scopeType: "project" | "team" | "org" | "global";

  /** Dependencies (skill IDs) */
  dependencies?: string[];

  /** Configuration */
  config?: Record<string, unknown>;

  /** Visibility level */
  visibility?: SkillVisibility;

  /** Error message (if status is 'failed') */
  error?: string;
}

/**
 * Skill query filters.
 */
export interface SkillQueryFilter {
  /** Filter by scope */
  scope?: string;

  /** Filter by scope type */
  scopeType?: InstalledSkill["scopeType"];

  /** Filter by status */
  status?: SkillInstallStatus;

  /** Filter by visibility */
  visibility?: SkillVisibility;

  /** Include disabled skills */
  includeDisabled?: boolean;

  /** Search by name pattern */
  namePattern?: string;
}

/**
 * Available update info.
 */
export interface SkillUpdate {
  skillId: string;
  currentVersion: SemanticVersion;
  latestVersion: SemanticVersion;
  releaseNotes?: string;
  breakingChanges?: boolean;
}

/**
 * Skill registry interface.
 */
export interface SkillRegistry {
  /**
   * Initialize the registry.
   */
  init(): Promise<void>;

  /**
   * Install a skill.
   */
  install(skill: Omit<InstalledSkill, "installedAt">): Promise<void>;

  /**
   * Get an installed skill.
   */
  get(id: string, scope?: string): Promise<InstalledSkill | null>;

  /**
   * List installed skills.
   */
  list(filter?: SkillQueryFilter): Promise<InstalledSkill[]>;

  /**
   * Update a skill to a new version.
   */
  update(id: string, version: SemanticVersion, scope?: string): Promise<void>;

  /**
   * Uninstall a skill.
   */
  uninstall(id: string, scope?: string): Promise<void>;

  /**
   * Enable a disabled skill.
   */
  enable(id: string, scope?: string): Promise<void>;

  /**
   * Disable a skill.
   */
  disable(id: string, scope?: string): Promise<void>;

  /**
   * Set skill status.
   */
  setStatus(id: string, status: SkillInstallStatus, error?: string, scope?: string): Promise<void>;

  /**
   * Get skill configuration.
   */
  getConfig(id: string, scope?: string): Promise<Record<string, unknown> | null>;

  /**
   * Update skill configuration.
   */
  setConfig(id: string, config: Record<string, unknown>, scope?: string): Promise<void>;

  /**
   * Find skills satisfying a version constraint.
   */
  findSatisfying(id: string, constraint: VersionConstraint): Promise<InstalledSkill[]>;

  /**
   * Get dependents of a skill.
   */
  getDependents(id: string): Promise<InstalledSkill[]>;

  /**
   * Check for available updates.
   */
  checkUpdates?(availableVersions: Map<string, SemanticVersion[]>): Promise<SkillUpdate[]>;
}

/**
 * In-memory skill registry for testing.
 */
export class InMemorySkillRegistry implements SkillRegistry {
  private skills: Map<string, InstalledSkill> = new Map();

  private makeKey(id: string, scope = "global"): string {
    return `${scope}:${id}`;
  }

  async init(): Promise<void> {}

  async install(skill: Omit<InstalledSkill, "installedAt">): Promise<void> {
    const key = this.makeKey(skill.id, skill.scope);
    const now = new Date().toISOString();

    this.skills.set(key, {
      ...skill,
      installedAt: now,
    });
  }

  async get(id: string, scope?: string): Promise<InstalledSkill | null> {
    const key = this.makeKey(id, scope);
    return this.skills.get(key) ?? null;
  }

  async list(filter?: SkillQueryFilter): Promise<InstalledSkill[]> {
    return Array.from(this.skills.values()).filter((skill) => {
      if (filter?.scope && skill.scope !== filter.scope) return false;
      if (filter?.scopeType && skill.scopeType !== filter.scopeType) return false;
      if (filter?.status && skill.status !== filter.status) return false;
      if (filter?.visibility && skill.visibility !== filter.visibility) return false;
      if (!filter?.includeDisabled && skill.status === "disabled") return false;

      if (filter?.namePattern) {
        const pattern = new RegExp(filter.namePattern, "i");
        if (!pattern.test(skill.id)) return false;
      }

      return true;
    });
  }

  async update(id: string, version: SemanticVersion, scope?: string): Promise<void> {
    const key = this.makeKey(id, scope);
    const skill = this.skills.get(key);
    if (!skill) throw new Error(`Skill ${id} not found`);

    skill.version = version;
    skill.updatedAt = new Date().toISOString();
  }

  async uninstall(id: string, scope?: string): Promise<void> {
    const key = this.makeKey(id, scope);
    this.skills.delete(key);
  }

  async enable(id: string, scope?: string): Promise<void> {
    const key = this.makeKey(id, scope);
    const skill = this.skills.get(key);
    if (skill) skill.status = "installed";
  }

  async disable(id: string, scope?: string): Promise<void> {
    const key = this.makeKey(id, scope);
    const skill = this.skills.get(key);
    if (skill) skill.status = "disabled";
  }

  async setStatus(
    id: string,
    status: SkillInstallStatus,
    error?: string,
    scope?: string,
  ): Promise<void> {
    const key = this.makeKey(id, scope);
    const skill = this.skills.get(key);
    if (skill) {
      skill.status = status;
      if (error) skill.error = error;
      else if (skill.error) delete skill.error;
    }
  }

  async getConfig(id: string, scope?: string): Promise<Record<string, unknown> | null> {
    const skill = await this.get(id, scope);
    return skill?.config ?? null;
  }

  async setConfig(id: string, config: Record<string, unknown>, scope?: string): Promise<void> {
    const key = this.makeKey(id, scope);
    const skill = this.skills.get(key);
    if (skill) skill.config = config;
  }

  async findSatisfying(id: string, constraint: VersionConstraint): Promise<InstalledSkill[]> {
    return Array.from(this.skills.values()).filter((skill) => {
      if (!skill.id.endsWith(id) && skill.id !== id) return false;
      return satisfiesConstraint(versionToString(skill.version), constraint);
    });
  }

  async getDependents(id: string): Promise<InstalledSkill[]> {
    return Array.from(this.skills.values()).filter((skill) => skill.dependencies?.includes(id));
  }

  async checkUpdates(availableVersions: Map<string, SemanticVersion[]>): Promise<SkillUpdate[]> {
    const updates: SkillUpdate[] = [];

    for (const skill of this.skills.values()) {
      const versions = availableVersions.get(skill.id);
      if (!versions?.length) continue;

      const sortedVersions = versions.sort((a, b) => compareSemanticVersions(b, a));
      const latest = sortedVersions[0]!;

      if (compareSemanticVersions(latest, skill.version) > 0) {
        updates.push({
          skillId: skill.id,
          currentVersion: skill.version,
          latestVersion: latest,
          breakingChanges: latest.major > skill.version.major,
        });
      }
    }

    return updates;
  }
}

/**
 * SQL-based skill registry.
 */
export class SqlSkillRegistry implements SkillRegistry {
  constructor(private db: DbAdapter) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS installed_skills (
        id TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        version_major INTEGER NOT NULL,
        version_minor INTEGER NOT NULL,
        version_patch INTEGER NOT NULL,
        version_prerelease TEXT,
        status TEXT NOT NULL DEFAULT 'installed',
        source TEXT NOT NULL,
        checksum TEXT,
        installed_at TEXT NOT NULL,
        updated_at TEXT,
        installed_by TEXT NOT NULL,
        dependencies TEXT,
        config TEXT,
        visibility TEXT,
        error TEXT,
        PRIMARY KEY (id, scope)
      )
    `);

    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_skills_scope ON installed_skills(scope)`);
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_skills_status ON installed_skills(status)`,
    );
  }

  async install(skill: Omit<InstalledSkill, "installedAt">): Promise<void> {
    const now = new Date().toISOString();

    await this.db.execute(
      `INSERT OR REPLACE INTO installed_skills 
       (id, scope, scope_type, version_major, version_minor, version_patch, version_prerelease, status, source, checksum, installed_at, installed_by, dependencies, config, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        skill.id,
        skill.scope,
        skill.scopeType,
        skill.version.major,
        skill.version.minor,
        skill.version.patch,
        skill.version.prerelease ?? null,
        skill.status,
        skill.source,
        skill.checksum ?? null,
        now,
        skill.installedBy,
        skill.dependencies ? JSON.stringify(skill.dependencies) : null,
        skill.config ? JSON.stringify(skill.config) : null,
        skill.visibility ?? null,
      ],
    );
  }

  async get(id: string, scope = "global"): Promise<InstalledSkill | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT * FROM installed_skills WHERE id = ? AND scope = ?`,
      [id, scope],
    );
    return row ? this.rowToSkill(row) : null;
  }

  async list(_filter?: SkillQueryFilter): Promise<InstalledSkill[]> {
    // Simplified - real version would build WHERE clause
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM installed_skills WHERE status != 'disabled' OR ? = 1`,
      [_filter?.includeDisabled ? 1 : 0],
    );
    return result.rows.map((row) => this.rowToSkill(row));
  }

  async update(id: string, version: SemanticVersion, scope = "global"): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE installed_skills 
       SET version_major = ?, version_minor = ?, version_patch = ?, version_prerelease = ?, updated_at = ?
       WHERE id = ? AND scope = ?`,
      [version.major, version.minor, version.patch, version.prerelease ?? null, now, id, scope],
    );
  }

  async uninstall(id: string, scope = "global"): Promise<void> {
    await this.db.execute(`DELETE FROM installed_skills WHERE id = ? AND scope = ?`, [id, scope]);
  }

  async enable(id: string, scope = "global"): Promise<void> {
    await this.setStatus(id, "installed", undefined, scope);
  }

  async disable(id: string, scope = "global"): Promise<void> {
    await this.setStatus(id, "disabled", undefined, scope);
  }

  async setStatus(
    id: string,
    status: SkillInstallStatus,
    error?: string,
    scope = "global",
  ): Promise<void> {
    await this.db.execute(
      `UPDATE installed_skills SET status = ?, error = ? WHERE id = ? AND scope = ?`,
      [status, error ?? null, id, scope],
    );
  }

  async getConfig(id: string, scope = "global"): Promise<Record<string, unknown> | null> {
    const row = await this.db.queryOne<{ config: string | null }>(
      `SELECT config FROM installed_skills WHERE id = ? AND scope = ?`,
      [id, scope],
    );
    return row?.config ? JSON.parse(row.config) : null;
  }

  async setConfig(id: string, config: Record<string, unknown>, scope = "global"): Promise<void> {
    await this.db.execute(`UPDATE installed_skills SET config = ? WHERE id = ? AND scope = ?`, [
      JSON.stringify(config),
      id,
      scope,
    ]);
  }

  async findSatisfying(id: string, constraint: VersionConstraint): Promise<InstalledSkill[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM installed_skills WHERE id = ? OR id LIKE ?`,
      [id, `%/${id}`],
    );

    return result.rows
      .map((row) => this.rowToSkill(row))
      .filter((skill) => satisfiesConstraint(versionToString(skill.version), constraint));
  }

  async getDependents(id: string): Promise<InstalledSkill[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM installed_skills WHERE dependencies LIKE ?`,
      [`%"${id}"%`],
    );
    return result.rows.map((row) => this.rowToSkill(row));
  }

  private rowToSkill(row: Record<string, unknown>): InstalledSkill {
    const version: SemanticVersion = {
      major: row["version_major"] as number,
      minor: row["version_minor"] as number,
      patch: row["version_patch"] as number,
    };
    if (row["version_prerelease"]) {
      version.prerelease = row["version_prerelease"] as string;
    }

    const skill: InstalledSkill = {
      id: row["id"] as string,
      version,
      status: row["status"] as SkillInstallStatus,
      source: row["source"] as string,
      installedAt: row["installed_at"] as string,
      installedBy: row["installed_by"] as string,
      scope: row["scope"] as string,
      scopeType: row["scope_type"] as InstalledSkill["scopeType"],
    };

    if (row["checksum"]) skill.checksum = row["checksum"] as string;
    if (row["updated_at"]) skill.updatedAt = row["updated_at"] as string;
    if (row["dependencies"]) skill.dependencies = JSON.parse(row["dependencies"] as string);
    if (row["config"]) skill.config = JSON.parse(row["config"] as string);
    if (row["visibility"]) skill.visibility = row["visibility"] as SkillVisibility;
    if (row["error"]) skill.error = row["error"] as string;

    return skill;
  }
}

/**
 * Create a skill registry with the given database adapter.
 */
export function createSkillRegistry(db: DbAdapter): SkillRegistry {
  return new SqlSkillRegistry(db);
}
