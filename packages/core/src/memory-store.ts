/**
 * Context & memory storage with scoped visibility (MEM-001).
 */

import type { DbAdapter } from "./db-adapter.js";

export type MemoryScope = "session" | "project" | "org";

export interface MemoryContext {
  orgId: string;
  projectId?: string;
  sessionId?: string;
}

export interface MemoryRecord {
  id: string;
  key?: string;
  content: string;
  scope: MemoryScope;
  orgId: string;
  projectId?: string;
  sessionId?: string;
  createdAt: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryWriteInput {
  id?: string;
  key?: string;
  content: string;
  scope: MemoryScope;
  context: MemoryContext;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface MemoryReadOptions {
  includeSharedFromBroaderScopes?: boolean;
  now?: Date;
}

export interface MemoryStore {
  init(): Promise<void>;
  write(input: MemoryWriteInput): Promise<MemoryRecord>;
  listByScope(
    scope: MemoryScope,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord[]>;
  getById(
    id: string,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord | null>;
  getByKey(
    key: string,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord | null>;
  pruneExpired(now?: Date): Promise<number>;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function randomId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildScopeContext(
  scope: MemoryScope,
  context: MemoryContext,
): Pick<MemoryRecord, "orgId" | "projectId" | "sessionId"> {
  if (scope === "session") {
    if (!context.projectId || !context.sessionId) {
      throw new Error("Session scope requires orgId, projectId, and sessionId context");
    }
    return { orgId: context.orgId, projectId: context.projectId, sessionId: context.sessionId };
  }
  if (scope === "project") {
    if (!context.projectId) {
      throw new Error("Project scope requires orgId and projectId context");
    }
    return { orgId: context.orgId, projectId: context.projectId };
  }
  return { orgId: context.orgId };
}

function isExpired(record: MemoryRecord, now: Date): boolean {
  return Boolean(record.expiresAt && new Date(record.expiresAt).getTime() <= now.getTime());
}

function canRead(
  record: MemoryRecord,
  targetScope: MemoryScope,
  context: MemoryContext,
  includeSharedFromBroaderScopes: boolean,
): boolean {
  if (record.orgId !== context.orgId) return false;

  const sameScope = record.scope === targetScope;
  const broaderShared =
    includeSharedFromBroaderScopes &&
    ((targetScope === "session" && (record.scope === "project" || record.scope === "org")) ||
      (targetScope === "project" && record.scope === "org"));

  if (!(sameScope || broaderShared)) return false;

  if (record.scope === "session") {
    if (record.projectId !== context.projectId) return false;
    if (record.sessionId !== context.sessionId) return false;
  }

  if (record.scope === "project" && record.projectId !== context.projectId) return false;

  return true;
}

export class InMemoryMemoryStore implements MemoryStore {
  private records = new Map<string, MemoryRecord>();
  private keyToId = new Map<string, string>();

  private makeKeyIndex(orgId: string, key: string): string {
    return `${orgId}:${key}`;
  }

  async init(): Promise<void> {}

  async write(input: MemoryWriteInput): Promise<MemoryRecord> {
    const id = input.id ?? randomId();
    const now = input.now ?? new Date();

    const existing = this.records.get(id);
    if (existing && existing.scope !== input.scope) {
      throw new Error(`Memory scope is immutable for id ${id}`);
    }

    const scopeContext = buildScopeContext(input.scope, input.context);
    const expiresAt =
      input.scope === "session"
        ? new Date(now.getTime() + SESSION_TTL_MS).toISOString()
        : undefined;

    const key = input.key ?? existing?.key;
    if (key) {
      const keyIndex = this.makeKeyIndex(scopeContext.orgId, key);
      const currentId = this.keyToId.get(keyIndex);
      if (currentId && currentId !== id) {
        throw new Error(`Memory key is already in use for org ${scopeContext.orgId}: ${key}`);
      }
    }

    const record: MemoryRecord = {
      id,
      ...(key ? { key } : {}),
      content: input.content,
      scope: input.scope,
      createdAt: existing?.createdAt ?? now.toISOString(),
      ...scopeContext,
      ...(expiresAt ? { expiresAt } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    if (existing?.key && existing.key !== key) {
      this.keyToId.delete(this.makeKeyIndex(existing.orgId, existing.key));
    }
    if (key) {
      this.keyToId.set(this.makeKeyIndex(scopeContext.orgId, key), id);
    }

    this.records.set(id, record);
    return record;
  }

  async listByScope(
    scope: MemoryScope,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord[]> {
    const now = options?.now ?? new Date();
    const includeShared = options?.includeSharedFromBroaderScopes ?? false;

    return Array.from(this.records.values())
      .filter((record) => !isExpired(record, now))
      .filter((record) => canRead(record, scope, context, includeShared))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getById(
    id: string,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord | null> {
    const now = options?.now ?? new Date();
    const includeShared = options?.includeSharedFromBroaderScopes ?? false;
    const record = this.records.get(id);
    if (!record || isExpired(record, now)) return null;

    const canReadAtAnyScope =
      canRead(record, "session", context, includeShared) ||
      canRead(record, "project", context, includeShared) ||
      canRead(record, "org", context, includeShared);

    return canReadAtAnyScope ? record : null;
  }

  async getByKey(
    key: string,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord | null> {
    const id = this.keyToId.get(this.makeKeyIndex(context.orgId, key));
    if (!id) return null;
    return this.getById(id, context, options);
  }

  async pruneExpired(now = new Date()): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (isExpired(record, now)) {
        this.records.delete(id);
        if (record.key) {
          this.keyToId.delete(this.makeKeyIndex(record.orgId, record.key));
        }
        removed += 1;
      }
    }
    return removed;
  }
}

interface MemoryRow {
  id: string;
  key: string | null;
  content: string;
  scope: MemoryScope;
  org_id: string;
  project_id: string | null;
  session_id: string | null;
  metadata: string | null;
  created_at: string;
  expires_at: string | null;
}

export class SqlMemoryStore implements MemoryStore {
  constructor(private db: DbAdapter) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        key TEXT,
        content TEXT NOT NULL,
        scope TEXT NOT NULL,
        org_id TEXT NOT NULL,
        project_id TEXT,
        session_id TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT
      )
    `);

    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_org ON memories(org_id)`);
    await this.db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_org_key_unique ON memories(org_id, key) WHERE key IS NOT NULL`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`,
    );
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at)`,
    );
  }

  async write(input: MemoryWriteInput): Promise<MemoryRecord> {
    const id = input.id ?? randomId();
    const now = input.now ?? new Date();
    const existing = await this.db.queryOne<{
      scope: string;
      created_at: string;
      key: string | null;
    }>(`SELECT scope, created_at, key FROM memories WHERE id = ?`, [id]);

    if (existing && existing.scope !== input.scope) {
      throw new Error(`Memory scope is immutable for id ${id}`);
    }

    const scopeContext = buildScopeContext(input.scope, input.context);
    const expiresAt =
      input.scope === "session" ? new Date(now.getTime() + SESSION_TTL_MS).toISOString() : null;
    const createdAt = existing?.created_at ?? now.toISOString();
    const key = input.key ?? existing?.key ?? null;

    await this.db.execute(
      `INSERT OR REPLACE INTO memories (id, key, content, scope, org_id, project_id, session_id, metadata, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        key,
        input.content,
        input.scope,
        scopeContext.orgId,
        scopeContext.projectId ?? null,
        scopeContext.sessionId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt,
        expiresAt,
      ],
    );

    return {
      id,
      ...(key ? { key } : {}),
      content: input.content,
      scope: input.scope,
      orgId: scopeContext.orgId,
      ...(scopeContext.projectId ? { projectId: scopeContext.projectId } : {}),
      ...(scopeContext.sessionId ? { sessionId: scopeContext.sessionId } : {}),
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
  }

  async listByScope(
    scope: MemoryScope,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord[]> {
    const now = (options?.now ?? new Date()).toISOString();
    const includeShared = options?.includeSharedFromBroaderScopes ?? false;

    const allowedScopes: MemoryScope[] = includeShared
      ? scope === "session"
        ? ["session", "project", "org"]
        : scope === "project"
          ? ["project", "org"]
          : ["org"]
      : [scope];

    const placeholders = allowedScopes.map(() => "?").join(",");
    const params: (string | null)[] = [context.orgId, ...allowedScopes, now];

    let query = `
      SELECT id, key, content, scope, org_id, project_id, session_id, metadata, created_at, expires_at
      FROM memories
      WHERE org_id = ?
        AND scope IN (${placeholders})
        AND (expires_at IS NULL OR expires_at > ?)
    `;

    if (scope === "session") {
      query += ` AND project_id = ? AND session_id = ?`;
      params.push(context.projectId ?? null, context.sessionId ?? null);
    } else if (scope === "project") {
      query += ` AND project_id = ?`;
      params.push(context.projectId ?? null);
    }

    query += ` ORDER BY created_at ASC`;

    const result = await this.db.query<MemoryRow>(query, params);
    return result.rows
      .map((row) => this.rowToRecord(row))
      .filter((record) => canRead(record, scope, context, includeShared));
  }

  async getById(
    id: string,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord | null> {
    const now = options?.now ?? new Date();
    const includeShared = options?.includeSharedFromBroaderScopes ?? false;

    const row = await this.db.queryOne<MemoryRow>(
      `SELECT id, key, content, scope, org_id, project_id, session_id, metadata, created_at, expires_at
       FROM memories
       WHERE id = ?`,
      [id],
    );

    if (!row) return null;

    const record = this.rowToRecord(row);
    if (isExpired(record, now)) return null;

    const canReadAtAnyScope =
      canRead(record, "session", context, includeShared) ||
      canRead(record, "project", context, includeShared) ||
      canRead(record, "org", context, includeShared);

    return canReadAtAnyScope ? record : null;
  }

  async getByKey(
    key: string,
    context: MemoryContext,
    options?: MemoryReadOptions,
  ): Promise<MemoryRecord | null> {
    const now = options?.now ?? new Date();
    const includeShared = options?.includeSharedFromBroaderScopes ?? false;

    const row = await this.db.queryOne<MemoryRow>(
      `SELECT id, key, content, scope, org_id, project_id, session_id, metadata, created_at, expires_at
       FROM memories
       WHERE org_id = ? AND key = ?`,
      [context.orgId, key],
    );

    if (!row) return null;

    const record = this.rowToRecord(row);
    if (isExpired(record, now)) return null;

    const canReadAtAnyScope =
      canRead(record, "session", context, includeShared) ||
      canRead(record, "project", context, includeShared) ||
      canRead(record, "org", context, includeShared);

    return canReadAtAnyScope ? record : null;
  }

  async pruneExpired(now = new Date()): Promise<number> {
    return this.db.execute(
      `DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      [now.toISOString()],
    );
  }

  private rowToRecord(row: MemoryRow): MemoryRecord {
    const metadataRaw = row.metadata;
    const metadata =
      typeof metadataRaw === "string"
        ? (JSON.parse(metadataRaw) as Record<string, unknown>)
        : undefined;

    return {
      id: String(row.id),
      ...(row.key ? { key: String(row.key) } : {}),
      content: String(row.content),
      scope: row.scope as MemoryScope,
      orgId: String(row.org_id),
      ...(row.project_id ? { projectId: String(row.project_id) } : {}),
      ...(row.session_id ? { sessionId: String(row.session_id) } : {}),
      createdAt: String(row.created_at),
      ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
      ...(metadata ? { metadata } : {}),
    };
  }
}

export function createMemoryStore(db: DbAdapter): MemoryStore {
  return new SqlMemoryStore(db);
}
