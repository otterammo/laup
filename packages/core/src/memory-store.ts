/**
 * Context & memory storage with scoped visibility (MEM-001).
 * Semantic retrieval support (MEM-002).
 */

import type { DbAdapter } from "./db-adapter.js";

export type MemoryScope = "session" | "project" | "org";

export interface MemoryContext {
  orgId: string;
  projectId?: string;
  sessionId?: string;
}

export interface MemoryEmbeddingProvider {
  embed(input: string, options?: { model?: string }): Promise<number[]>;
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
  embedding?: number[];
  embeddingModel?: string;
}

export interface MemoryWriteInput {
  id?: string;
  key?: string;
  content: string;
  scope: MemoryScope;
  context: MemoryContext;
  metadata?: Record<string, unknown>;
  embeddingModel?: string;
  now?: Date;
}

export interface MemoryReadOptions {
  includeSharedFromBroaderScopes?: boolean;
  now?: Date;
}

export interface MemorySearchOptions {
  includeSharedFromBroaderScopes?: boolean;
  now?: Date;
  k?: number;
  embeddingModel?: string;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  score: number;
}

export interface MemoryStore {
  init(): Promise<void>;
  write(input: MemoryWriteInput): Promise<MemoryRecord>;
  writeBatch(inputs: MemoryWriteInput[]): Promise<MemoryRecord[]>;
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
  semanticSearch(
    query: string,
    scope: MemoryScope,
    context: MemoryContext,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult[]>;
  pruneExpired(now?: Date): Promise<number>;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOP_K = 10;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

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

class DefaultMemoryEmbeddingProvider implements MemoryEmbeddingProvider {
  async embed(input: string): Promise<number[]> {
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    const text = input.toLowerCase();
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      out[i % out.length] = (out[i % out.length] ?? 0) + (code % 31) / 31;
    }
    return out;
  }
}

export interface MemoryStoreRuntimeOptions {
  embeddingProvider?: MemoryEmbeddingProvider;
  defaultEmbeddingModel?: string;
  defaultTopK?: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryMemoryStore implements MemoryStore {
  private records = new Map<string, MemoryRecord>();
  private keyToId = new Map<string, string>();
  private embeddingProvider: MemoryEmbeddingProvider;
  private defaultEmbeddingModel: string;
  private defaultTopK: number;

  constructor(options?: MemoryStoreRuntimeOptions) {
    this.embeddingProvider = options?.embeddingProvider ?? new DefaultMemoryEmbeddingProvider();
    this.defaultEmbeddingModel = options?.defaultEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.defaultTopK = Math.max(1, options?.defaultTopK ?? DEFAULT_TOP_K);
  }

  async init(): Promise<void> {}

  private makeKeyIndex(
    context: Pick<MemoryRecord, "orgId" | "projectId" | "sessionId">,
    key: string,
  ): string {
    return `${context.orgId}::${key}`;
  }

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

    const nextKey = input.key ?? existing?.key;
    if (nextKey) {
      const keyIndex = this.makeKeyIndex(scopeContext, nextKey);
      const currentId = this.keyToId.get(keyIndex);
      if (currentId && currentId !== id) {
        throw new Error(`Memory key is already in use in this scope: ${nextKey}`);
      }
    }

    const embeddingModel = input.embeddingModel ?? this.defaultEmbeddingModel;
    const embedding = await this.embeddingProvider.embed(input.content, { model: embeddingModel });

    const record: MemoryRecord = {
      id,
      ...(nextKey ? { key: nextKey } : {}),
      content: input.content,
      scope: input.scope,
      createdAt: existing?.createdAt ?? now.toISOString(),
      embedding,
      embeddingModel,
      ...scopeContext,
      ...(expiresAt ? { expiresAt } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };

    if (existing?.key && existing.key !== nextKey) {
      this.keyToId.delete(this.makeKeyIndex(existing, existing.key));
    }
    if (nextKey) {
      this.keyToId.set(this.makeKeyIndex(scopeContext, nextKey), id);
    }

    this.records.set(id, record);
    return record;
  }

  async writeBatch(inputs: MemoryWriteInput[]): Promise<MemoryRecord[]> {
    const out: MemoryRecord[] = [];
    for (const input of inputs) out.push(await this.write(input));
    return out;
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
    const sessionContext: Pick<MemoryRecord, "orgId" | "projectId" | "sessionId"> = {
      orgId: context.orgId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    };
    const projectContext: Pick<MemoryRecord, "orgId" | "projectId" | "sessionId"> = {
      orgId: context.orgId,
      ...(context.projectId ? { projectId: context.projectId } : {}),
    };
    const orgContext: Pick<MemoryRecord, "orgId" | "projectId" | "sessionId"> = {
      orgId: context.orgId,
    };

    const sessionScopedId = this.keyToId.get(this.makeKeyIndex(sessionContext, key));
    if (sessionScopedId) return this.getById(sessionScopedId, context, options);

    const projectScopedId = this.keyToId.get(this.makeKeyIndex(projectContext, key));
    if (projectScopedId) return this.getById(projectScopedId, context, options);

    const orgScopedId = this.keyToId.get(this.makeKeyIndex(orgContext, key));
    if (orgScopedId) return this.getById(orgScopedId, context, options);

    return null;
  }

  async semanticSearch(
    query: string,
    scope: MemoryScope,
    context: MemoryContext,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult[]> {
    const now = options?.now ?? new Date();
    const includeShared = options?.includeSharedFromBroaderScopes ?? false;
    const k = Math.max(1, options?.k ?? this.defaultTopK);
    const model = options?.embeddingModel ?? this.defaultEmbeddingModel;
    const queryEmbedding = await this.embeddingProvider.embed(query, { model });

    return Array.from(this.records.values())
      .filter((record) => !isExpired(record, now))
      .filter((record) => canRead(record, scope, context, includeShared))
      .map((memory) => ({
        memory,
        score: cosineSimilarity(queryEmbedding, memory.embedding ?? []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  async pruneExpired(now = new Date()): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (isExpired(record, now)) {
        this.records.delete(id);
        if (record.key) {
          this.keyToId.delete(this.makeKeyIndex(record, record.key));
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
  embedding: string | null;
  embedding_model: string | null;
  created_at: string;
  expires_at: string | null;
}

export class SqlMemoryStore implements MemoryStore {
  private embeddingProvider: MemoryEmbeddingProvider;
  private defaultEmbeddingModel: string;
  private defaultTopK: number;

  constructor(
    private db: DbAdapter,
    options?: MemoryStoreRuntimeOptions,
  ) {
    this.embeddingProvider = options?.embeddingProvider ?? new DefaultMemoryEmbeddingProvider();
    this.defaultEmbeddingModel = options?.defaultEmbeddingModel ?? DEFAULT_EMBEDDING_MODEL;
    this.defaultTopK = Math.max(1, options?.defaultTopK ?? DEFAULT_TOP_K);
  }

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
        embedding TEXT,
        embedding_model TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT
      )
    `);

    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope)`);
    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_memories_org ON memories(org_id)`);
    await this.db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_org_key_unique
       ON memories(org_id, key)
       WHERE key IS NOT NULL`,
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

    const embeddingModel = input.embeddingModel ?? this.defaultEmbeddingModel;
    const embedding = await this.embeddingProvider.embed(input.content, { model: embeddingModel });

    await this.db.execute(
      `INSERT OR REPLACE INTO memories (id, key, content, scope, org_id, project_id, session_id, metadata, embedding, embedding_model, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        key,
        input.content,
        input.scope,
        scopeContext.orgId,
        scopeContext.projectId ?? null,
        scopeContext.sessionId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        JSON.stringify(embedding),
        embeddingModel,
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
      embedding,
      embeddingModel,
    };
  }

  async writeBatch(inputs: MemoryWriteInput[]): Promise<MemoryRecord[]> {
    const out: MemoryRecord[] = [];
    for (const input of inputs) out.push(await this.write(input));
    return out;
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
      SELECT id, key, content, scope, org_id, project_id, session_id, metadata, embedding, embedding_model, created_at, expires_at
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
      `SELECT id, key, content, scope, org_id, project_id, session_id, metadata, embedding, embedding_model, created_at, expires_at
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
      `SELECT id, key, content, scope, org_id, project_id, session_id, metadata, embedding, embedding_model, created_at, expires_at
       FROM memories
       WHERE org_id = ?
         AND key = ?
         AND (
           (project_id = ? AND session_id = ?)
           OR (project_id = ? AND session_id IS NULL)
           OR (project_id IS NULL AND session_id IS NULL)
         )
       ORDER BY
         CASE
           WHEN project_id = ? AND session_id = ? THEN 0
           WHEN project_id = ? AND session_id IS NULL THEN 1
           ELSE 2
         END
       LIMIT 1`,
      [
        context.orgId,
        key,
        context.projectId ?? null,
        context.sessionId ?? null,
        context.projectId ?? null,
        context.projectId ?? null,
        context.sessionId ?? null,
        context.projectId ?? null,
      ],
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

  async semanticSearch(
    query: string,
    scope: MemoryScope,
    context: MemoryContext,
    options?: MemorySearchOptions,
  ): Promise<MemorySearchResult[]> {
    const k = Math.max(1, options?.k ?? this.defaultTopK);
    const model = options?.embeddingModel ?? this.defaultEmbeddingModel;
    const queryEmbedding = await this.embeddingProvider.embed(query, { model });
    const visible = await this.listByScope(scope, context, options);

    return visible
      .map((memory) => ({
        memory,
        score: cosineSimilarity(queryEmbedding, memory.embedding ?? []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
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

    const embedding =
      typeof row.embedding === "string" ? (JSON.parse(row.embedding) as number[]) : undefined;

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
      ...(embedding ? { embedding } : {}),
      ...(row.embedding_model ? { embeddingModel: String(row.embedding_model) } : {}),
    };
  }
}

export function createMemoryStore(db: DbAdapter): MemoryStore {
  return new SqlMemoryStore(db);
}

export function createSemanticMemoryStore(options?: MemoryStoreRuntimeOptions): MemoryStore {
  return new InMemoryMemoryStore(options);
}
