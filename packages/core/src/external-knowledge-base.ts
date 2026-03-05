import type {
  MemoryContext,
  MemoryReadOptions,
  MemoryRecord,
  MemoryScope,
  MemorySearchOptions,
  MemorySearchResult,
  MemoryStore,
  MemoryWriteInput,
} from "./memory-store.js";

export type ExternalKnowledgeBaseProvider = "confluence" | "notion";

export interface ExternalKnowledgeDocument {
  externalId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ExternalKnowledgeBaseConnector {
  readonly provider: ExternalKnowledgeBaseProvider;
  listDocuments(): Promise<ExternalKnowledgeDocument[]>;
}

export interface ConfluenceConnectorOptions {
  baseUrl: string;
  spaceKey: string;
  authToken: string;
  fetcher?: typeof fetch;
  limit?: number;
}

export interface NotionConnectorOptions {
  authToken: string;
  databaseId: string;
  fetcher?: typeof fetch;
  pageSize?: number;
}

interface ConfluenceSearchResponse {
  results?: Array<{
    id?: string;
    title?: string;
    _links?: { webui?: string };
    version?: { when?: string };
    body?: { storage?: { value?: string } };
  }>;
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class ConfluenceKnowledgeBaseConnector implements ExternalKnowledgeBaseConnector {
  readonly provider = "confluence" as const;
  private fetcher: typeof fetch;
  private limit: number;

  constructor(private readonly options: ConfluenceConnectorOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.limit = Math.max(1, options.limit ?? 100);
  }

  async listDocuments(): Promise<ExternalKnowledgeDocument[]> {
    const cql = encodeURIComponent(`space=${this.options.spaceKey} and type=page`);
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/wiki/rest/api/content/search?cql=${cql}&limit=${this.limit}&expand=body.storage,version`;
    const response = await this.fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.options.authToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Confluence request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as ConfluenceSearchResponse;
    return (payload.results ?? [])
      .filter((entry) => entry.id && entry.title)
      .map((entry) => ({
        externalId: entry.id as string,
        title: entry.title as string,
        content: stripHtml(entry.body?.storage?.value ?? ""),
        ...(entry._links?.webui
          ? { sourceUrl: `${this.options.baseUrl.replace(/\/$/, "")}${entry._links.webui}` }
          : {}),
        ...(entry.version?.when ? { updatedAt: entry.version.when } : {}),
      }));
  }
}

interface NotionListResponse {
  results?: Array<{
    id?: string;
    url?: string;
    last_edited_time?: string;
    properties?: Record<string, unknown>;
  }>;
}

function notionTitle(properties: Record<string, unknown> | undefined): string {
  if (!properties) return "Untitled";
  const propertyValues = Object.values(properties);
  for (const value of propertyValues) {
    if (!value || typeof value !== "object") continue;
    const property = value as { type?: string; title?: Array<{ plain_text?: string }> };
    if (property.type === "title" && Array.isArray(property.title)) {
      const text = property.title
        .map((part) => part.plain_text ?? "")
        .join("")
        .trim();
      if (text) return text;
    }
  }
  return "Untitled";
}

function notionSummary(properties: Record<string, unknown> | undefined): string {
  if (!properties) return "";
  const snippets: string[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    if (!raw || typeof raw !== "object") continue;
    const value = raw as {
      type?: string;
      rich_text?: Array<{ plain_text?: string }>;
      select?: { name?: string };
      multi_select?: Array<{ name?: string }>;
    };
    if (value.type === "rich_text" && Array.isArray(value.rich_text)) {
      const text = value.rich_text
        .map((item) => item.plain_text ?? "")
        .join("")
        .trim();
      if (text) snippets.push(`${name}: ${text}`);
      continue;
    }
    if (value.type === "select" && value.select?.name) {
      snippets.push(`${name}: ${value.select.name}`);
      continue;
    }
    if (value.type === "multi_select" && Array.isArray(value.multi_select)) {
      const choices = value.multi_select.map((choice) => choice.name ?? "").filter(Boolean);
      if (choices.length > 0) snippets.push(`${name}: ${choices.join(", ")}`);
    }
  }
  return snippets.join("\n");
}

export class NotionKnowledgeBaseConnector implements ExternalKnowledgeBaseConnector {
  readonly provider = "notion" as const;
  private fetcher: typeof fetch;
  private pageSize: number;

  constructor(private readonly options: NotionConnectorOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.pageSize = Math.max(1, Math.min(100, options.pageSize ?? 100));
  }

  async listDocuments(): Promise<ExternalKnowledgeDocument[]> {
    const response = await this.fetcher(
      `https://api.notion.com/v1/databases/${this.options.databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.authToken}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
        body: JSON.stringify({ page_size: this.pageSize }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as NotionListResponse;
    return (payload.results ?? [])
      .filter((entry) => entry.id)
      .map((entry) => {
        const title = notionTitle(entry.properties);
        const summary = notionSummary(entry.properties);
        return {
          externalId: entry.id as string,
          title,
          content: [title, summary].filter(Boolean).join("\n\n"),
          ...(entry.url ? { sourceUrl: entry.url } : {}),
          ...(entry.last_edited_time ? { updatedAt: entry.last_edited_time } : {}),
        };
      });
  }
}

export interface ExternalKnowledgeSyncOptions {
  context: MemoryContext;
  scope?: MemoryScope;
  syncIntervalMs?: number;
  now?: () => Date;
}

export interface ExternalKnowledgeSyncResult {
  provider: ExternalKnowledgeBaseProvider;
  indexedCount: number;
}

const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;

interface ExternalKnowledgeMetadata {
  externalKnowledgeBase?: unknown;
}

export function isExternalKnowledgeRecord(record: MemoryRecord): boolean {
  const metadata = record.metadata as ExternalKnowledgeMetadata | undefined;
  return (
    typeof metadata?.externalKnowledgeBase === "object" && metadata.externalKnowledgeBase !== null
  );
}

export function annotateExternalKnowledgeResults(
  results: MemorySearchResult[],
): Array<MemorySearchResult & { external: boolean }> {
  return results.map((result) => ({
    ...result,
    external: isExternalKnowledgeRecord(result.memory),
  }));
}

export class ExternalKnowledgeSyncService {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly connectors: ExternalKnowledgeBaseConnector[],
    private readonly options: ExternalKnowledgeSyncOptions,
  ) {}

  async syncOnce(): Promise<ExternalKnowledgeSyncResult[]> {
    const scope = this.options.scope ?? "org";
    const now = this.options.now?.() ?? new Date();
    const output: ExternalKnowledgeSyncResult[] = [];

    for (const connector of this.connectors) {
      const docs = await connector.listDocuments();
      const writes: MemoryWriteInput[] = docs.map((doc) => ({
        id: `external:${connector.provider}:${doc.externalId}`,
        key: `external:${connector.provider}:${doc.externalId}`,
        content: doc.content,
        scope,
        context: this.options.context,
        sourceToolId: `external-kb:${connector.provider}`,
        metadata: {
          externalKnowledgeBase: {
            provider: connector.provider,
            externalId: doc.externalId,
            title: doc.title,
            ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
            ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
            syncedAt: now.toISOString(),
          },
        },
        tags: ["external-kb", connector.provider],
        category: "external-knowledge",
        now,
      }));

      await this.memoryStore.writeBatch(writes);
      output.push({ provider: connector.provider, indexedCount: writes.length });
    }

    return output;
  }

  start(): void {
    if (this.intervalHandle) return;
    const intervalMs = Math.max(1, this.options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS);
    this.intervalHandle = setInterval(() => {
      void this.syncOnce();
    }, intervalMs);
  }

  stop(): void {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }

  getSyncIntervalMs(): number {
    return Math.max(1, this.options.syncIntervalMs ?? DEFAULT_SYNC_INTERVAL_MS);
  }
}

export async function searchMemoryIncludingExternalSources(
  memoryStore: MemoryStore,
  query: string,
  scope: MemoryScope,
  context: MemoryContext,
  options?: MemorySearchOptions,
): Promise<Array<MemorySearchResult & { external: boolean }>> {
  const results = await memoryStore.semanticSearch(query, scope, context, options);
  return annotateExternalKnowledgeResults(results);
}

export async function listMemoryIncludingExternalSources(
  memoryStore: MemoryStore,
  scope: MemoryScope,
  context: MemoryContext,
  options?: MemoryReadOptions,
): Promise<Array<MemoryRecord & { external: boolean }>> {
  const records = await memoryStore.listByScope(scope, context, options);
  return records.map((record) => ({ ...record, external: isExternalKnowledgeRecord(record) }));
}
