import type { MemoryContext, MemoryRecord, MemoryScope, MemoryStore } from "./memory-store.js";

export interface ZepMessage {
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ZepMemory {
  uuid: string;
  content: string;
  role: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  score?: number;
}

export interface ZepAddMemoryParams {
  session_id: string;
  memory: string | ZepMessage | ZepMessage[];
  metadata?: Record<string, unknown>;
}

export interface ZepSearchMemoryParams {
  session_id: string;
  query: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface ZepGetMemoryParams {
  session_id: string;
  memory_id?: string;
  limit?: number;
}

export interface ZepExtractMemoryParams {
  session_id: string;
  transcript: string | ZepMessage | ZepMessage[];
  metadata?: Record<string, unknown>;
  limit?: number;
}

export interface ZepContextResolver {
  resolve(params: { session_id: string }): {
    context: MemoryContext;
    scope: MemoryScope;
  };
}

export interface ZepSessionMemoryClient {
  add_memory(
    memory: string | ZepMessage | ZepMessage[],
    metadata?: Record<string, unknown>,
  ): Promise<ZepMemory[]>;
  search_memory(
    query: string,
    options?: { limit?: number; filters?: Record<string, unknown> },
  ): Promise<ZepMemory[]>;
  get_memory(memory_id?: string): Promise<ZepMemory[] | ZepMemory | null>;
  extract_memory(
    transcript: string | ZepMessage | ZepMessage[],
    options?: { metadata?: Record<string, unknown>; limit?: number },
  ): Promise<ZepMemory[]>;
}

export interface ZepCompatibleMemoryClient {
  session(sessionId: string): ZepSessionMemoryClient;
  add_memory(params: ZepAddMemoryParams): Promise<ZepMemory[]>;
  search_memory(params: ZepSearchMemoryParams): Promise<ZepMemory[]>;
  get_memory(params: ZepGetMemoryParams): Promise<ZepMemory[] | ZepMemory | null>;
  extract_memory(params: ZepExtractMemoryParams): Promise<ZepMemory[]>;
}

export class DefaultZepContextResolver implements ZepContextResolver {
  constructor(
    private readonly defaults: {
      orgId: string;
      projectId?: string;
      scope?: MemoryScope;
    },
  ) {}

  resolve(params: { session_id: string }): {
    context: MemoryContext;
    scope: MemoryScope;
  } {
    const scope = this.defaults.scope ?? "session";
    const projectId = this.defaults.projectId ?? "zep";

    if (scope === "session") {
      return {
        context: {
          orgId: this.defaults.orgId,
          projectId,
          sessionId: params.session_id,
        },
        scope,
      };
    }

    if (scope === "project") {
      return {
        context: {
          orgId: this.defaults.orgId,
          projectId,
        },
        scope,
      };
    }

    return {
      context: {
        orgId: this.defaults.orgId,
      },
      scope,
    };
  }
}

class BoundZepSessionMemoryClient implements ZepSessionMemoryClient {
  constructor(
    private readonly client: ZepMemoryClient,
    private readonly sessionId: string,
  ) {}

  add_memory(
    memory: string | ZepMessage | ZepMessage[],
    metadata?: Record<string, unknown>,
  ): Promise<ZepMemory[]> {
    return this.client.add_memory({
      session_id: this.sessionId,
      memory,
      ...(metadata ? { metadata } : {}),
    });
  }

  search_memory(
    query: string,
    options?: { limit?: number; filters?: Record<string, unknown> },
  ): Promise<ZepMemory[]> {
    return this.client.search_memory({
      session_id: this.sessionId,
      query,
      ...(options?.limit ? { limit: options.limit } : {}),
      ...(options?.filters ? { filters: options.filters } : {}),
    });
  }

  get_memory(memory_id?: string): Promise<ZepMemory[] | ZepMemory | null> {
    return this.client.get_memory({
      session_id: this.sessionId,
      ...(memory_id ? { memory_id } : {}),
    });
  }

  extract_memory(
    transcript: string | ZepMessage | ZepMessage[],
    options?: { metadata?: Record<string, unknown>; limit?: number },
  ): Promise<ZepMemory[]> {
    return this.client.extract_memory({
      session_id: this.sessionId,
      transcript,
      ...(options?.metadata ? { metadata: options.metadata } : {}),
      ...(options?.limit ? { limit: options.limit } : {}),
    });
  }
}

export class ZepMemoryClient implements ZepCompatibleMemoryClient {
  constructor(
    private readonly store: MemoryStore,
    private readonly resolver: ZepContextResolver,
  ) {}

  session(sessionId: string): ZepSessionMemoryClient {
    return new BoundZepSessionMemoryClient(this, sessionId);
  }

  async add_memory(params: ZepAddMemoryParams): Promise<ZepMemory[]> {
    const normalized = this.normalizeMemory(params.memory);
    const { context, scope } = this.resolver.resolve({ session_id: params.session_id });

    const writes = normalized.map((entry) =>
      this.store.write({
        content: entry.content,
        scope,
        context,
        sourceToolId: "zep",
        metadata: {
          source: "zep",
          role: entry.role,
          ...(entry.metadata ? entry.metadata : {}),
          ...(params.metadata ? params.metadata : {}),
        },
      }),
    );

    const records = await Promise.all(writes);
    return records.map((record) => this.toZepMemory(record));
  }

  async search_memory(params: ZepSearchMemoryParams): Promise<ZepMemory[]> {
    const { context, scope } = this.resolver.resolve({ session_id: params.session_id });
    const records = await this.store.listByScope(scope, context, {
      includeSharedFromBroaderScopes: true,
    });

    return records
      .map((record) => ({ record, score: this.score(record, params.query) }))
      .filter((item) => item.score > 0)
      .filter((item) => this.matchesFilters(item.record, params.filters))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit ?? 10)
      .map((item) => this.toZepMemory(item.record, item.score));
  }

  async get_memory(params: ZepGetMemoryParams): Promise<ZepMemory[] | ZepMemory | null> {
    const { context, scope } = this.resolver.resolve({ session_id: params.session_id });

    if (params.memory_id) {
      const record = await this.store.getById(params.memory_id, context);
      if (!record || record.scope !== scope) {
        return null;
      }
      return this.toZepMemory(record);
    }

    const records = await this.store.listByScope(scope, context, {
      includeSharedFromBroaderScopes: true,
    });
    const sorted = records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted.slice(0, params.limit ?? 50).map((record) => this.toZepMemory(record));
  }

  async extract_memory(params: ZepExtractMemoryParams): Promise<ZepMemory[]> {
    const messages = this.normalizeMemory(params.transcript);
    const facts = this.extractFacts(messages).slice(0, params.limit ?? 10);
    const { context, scope } = this.resolver.resolve({ session_id: params.session_id });

    const writes = facts.map((fact) =>
      this.store.write({
        content: fact.content,
        scope,
        context,
        sourceToolId: "zep",
        metadata: {
          source: "zep",
          role: fact.role,
          extracted_from: "session-transcript",
          extraction_method: "heuristic-v1",
          transcript_turn: fact.turn,
          ...(params.metadata ? params.metadata : {}),
        },
      }),
    );

    const records = await Promise.all(writes);
    return records.map((record) => this.toZepMemory(record));
  }

  private normalizeMemory(memory: string | ZepMessage | ZepMessage[]): ZepMessage[] {
    if (typeof memory === "string") {
      return [{ role: "user", content: memory }];
    }

    if (Array.isArray(memory)) {
      return memory.filter((message) => message.content.trim().length > 0);
    }

    return memory.content.trim().length > 0 ? [memory] : [];
  }

  private toZepMemory(record: MemoryRecord, score?: number): ZepMemory {
    const roleValue = record.metadata?.["role"];

    return {
      uuid: record.id,
      content: record.content,
      role: typeof roleValue === "string" ? roleValue : "user",
      ...(record.metadata ? { metadata: record.metadata } : {}),
      created_at: record.createdAt,
      ...(typeof score === "number" ? { score } : {}),
    };
  }

  private extractFacts(
    messages: ZepMessage[],
  ): Array<{ content: string; role: string; turn: number }> {
    const candidates: Array<{ content: string; role: string; turn: number }> = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message) continue;

      const role = message.role.trim().toLowerCase();
      if (role !== "user" && role !== "assistant") continue;

      const snippets = message.content
        .split(/[\n.?!]+/)
        .map((part) => part.trim())
        .filter(Boolean);

      for (const snippet of snippets) {
        if (!this.looksLikeMemoryFact(snippet, role)) continue;

        const normalized = snippet
          .replace(/^(please\s+)?remember\s+(that\s+)?/i, "")
          .replace(/^note\s+that\s+/i, "")
          .trim();

        if (normalized.length < 8) continue;

        candidates.push({
          content: normalized,
          role,
          turn: index + 1,
        });
      }
    }

    const unique = new Map<string, { content: string; role: string; turn: number }>();
    for (const item of candidates) {
      const key = item.content.toLowerCase();
      if (!unique.has(key)) {
        unique.set(key, item);
      }
    }

    return [...unique.values()];
  }

  private looksLikeMemoryFact(text: string, role: string): boolean {
    if (role === "assistant") {
      return /\b(you\s+(prefer|like|dislike|asked|want|need)|noted|remembered)\b/i.test(text);
    }

    return /\b(remember|prefer|like|dislike|always|never|my|i\s+am|i'm|call\s+me|timezone|allergic|deadline|working\s+on)\b/i.test(
      text,
    );
  }

  private score(record: MemoryRecord, query: string): number {
    const needle = query.trim().toLowerCase();
    if (!needle) return 0;

    const haystack = [record.content, record.key ?? "", JSON.stringify(record.metadata ?? {})]
      .join("\n")
      .toLowerCase();

    if (haystack === needle) return 1;
    if (haystack.includes(needle)) return 0.8;

    const tokens = needle.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 0;

    const hits = tokens.filter((token) => haystack.includes(token)).length;
    return hits > 0 ? hits / tokens.length : 0;
  }

  private matchesFilters(record: MemoryRecord, filters?: Record<string, unknown>): boolean {
    if (!filters) return true;

    for (const [key, value] of Object.entries(filters)) {
      if (record.metadata?.[key] !== value) {
        return false;
      }
    }

    return true;
  }
}
