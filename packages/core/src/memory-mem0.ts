import type { MemoryContext, MemoryRecord, MemoryScope, MemoryStore } from "./memory-store.js";

export interface Mem0Message {
  role: string;
  content: string;
}

export interface Mem0AddParams {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  metadata?: Record<string, unknown>;
}

export interface Mem0SearchParams {
  query: string;
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface Mem0DeleteParams {
  memory_id: string;
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}

export interface Mem0SearchResult {
  id: string;
  memory: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface Mem0ContextResolver {
  resolve(params: {
    user_id?: string;
    agent_id?: string;
    run_id?: string;
  }): { context: MemoryContext; scope?: MemoryScope };
}

export interface Mem0CompatibleMemoryClient {
  add(messages: string | Mem0Message[], params?: Mem0AddParams): Promise<MemoryRecord[]>;
  search(params: Mem0SearchParams): Promise<Mem0SearchResult[]>;
  delete(memoryIdOrParams: string | Mem0DeleteParams): Promise<{ id: string; deleted: boolean }>;
}

export class DefaultMem0ContextResolver implements Mem0ContextResolver {
  constructor(
    private readonly defaults: {
      orgId: string;
      projectId?: string;
      sessionId?: string;
      scope?: MemoryScope;
    },
  ) {}

  resolve(params: { user_id?: string; agent_id?: string; run_id?: string }): {
    context: MemoryContext;
    scope?: MemoryScope;
  } {
    const orgId = params.user_id ?? this.defaults.orgId;
    const projectId = params.agent_id ?? this.defaults.projectId;
    const sessionId = params.run_id ?? this.defaults.sessionId;

    return {
      context: {
        orgId,
        ...(projectId ? { projectId } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
      ...(this.defaults.scope ? { scope: this.defaults.scope } : {}),
    };
  }
}

export class Mem0MemoryClient implements Mem0CompatibleMemoryClient {
  constructor(
    private readonly store: MemoryStore,
    private readonly resolver: Mem0ContextResolver,
  ) {}

  async add(messages: string | Mem0Message[], params?: Mem0AddParams): Promise<MemoryRecord[]> {
    const normalized = this.normalizeMessages(messages);
    const { context, scope } = this.resolver.resolve({
      ...(params?.user_id ? { user_id: params.user_id } : {}),
      ...(params?.agent_id ? { agent_id: params.agent_id } : {}),
      ...(params?.run_id ? { run_id: params.run_id } : {}),
    });

    const resolvedScope = scope ?? this.pickScope(context);
    const writes = normalized.map((message) =>
      this.store.write({
        content: message.content,
        scope: resolvedScope,
        context,
        sourceToolId: "mem0",
        metadata: {
          source: "mem0",
          role: message.role,
          ...(params?.metadata ? params.metadata : {}),
        },
      }),
    );

    return Promise.all(writes);
  }

  async search(params: Mem0SearchParams): Promise<Mem0SearchResult[]> {
    const { context } = this.resolver.resolve({
      ...(params.user_id ? { user_id: params.user_id } : {}),
      ...(params.agent_id ? { agent_id: params.agent_id } : {}),
      ...(params.run_id ? { run_id: params.run_id } : {}),
    });

    const scope = this.pickScope(context);
    const records = await this.store.listByScope(scope, context, {
      includeSharedFromBroaderScopes: true,
    });

    const filtered = records
      .map((record) => ({
        record,
        score: this.score(record, params.query),
      }))
      .filter((item) => item.score > 0)
      .filter((item) => this.matchesFilters(item.record, params.filters))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit ?? 10)
      .map((item) => ({
        id: item.record.id,
        memory: item.record.content,
        score: item.score,
        ...(item.record.metadata ? { metadata: item.record.metadata } : {}),
      }));

    return filtered;
  }

  async delete(memoryIdOrParams: string | Mem0DeleteParams): Promise<{ id: string; deleted: boolean }> {
    const input =
      typeof memoryIdOrParams === "string"
        ? ({ memory_id: memoryIdOrParams } satisfies Mem0DeleteParams)
        : memoryIdOrParams;

    const { context } = this.resolver.resolve({
      ...(input.user_id ? { user_id: input.user_id } : {}),
      ...(input.agent_id ? { agent_id: input.agent_id } : {}),
      ...(input.run_id ? { run_id: input.run_id } : {}),
    });

    const deleted = await this.store.deleteById(input.memory_id, context);
    return { id: input.memory_id, deleted };
  }

  private normalizeMessages(messages: string | Mem0Message[]): Mem0Message[] {
    if (typeof messages === "string") {
      return [{ role: "user", content: messages }];
    }

    return messages.filter((message) => message.content.trim().length > 0);
  }

  private pickScope(context: MemoryContext): MemoryScope {
    if (context.sessionId && context.projectId) return "session";
    if (context.projectId) return "project";
    return "org";
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
      const metadataValue = record.metadata?.[key];
      if (metadataValue !== value) {
        return false;
      }
    }
    return true;
  }
}
