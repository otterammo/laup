import type { MemoryContext, MemoryRecord, MemoryScope, MemoryStore } from "./memory-store.js";

export interface MemorySummarizationProjectConfig {
  enabled: boolean;
  scheduleMs: number;
  maxAgeMs: number;
  minRecords?: number;
  maxRecordsPerSummary?: number;
  scopes?: MemoryScope[];
}

export interface MemorySummarizationPipelineOptions {
  now?: () => Date;
  summarySourceToolId?: string;
  summarize?: (records: MemoryRecord[]) => string;
}

export interface MemorySummarizationRunResult {
  orgId: string;
  projectId: string;
  summarizedCount: number;
  archivedCount: number;
  summaryId?: string;
  skipped: boolean;
}

interface ProjectConfigEntry {
  context: MemoryContext;
  config: MemorySummarizationProjectConfig;
  timer?: ReturnType<typeof setInterval>;
}

const DEFAULT_SCOPES: MemoryScope[] = ["project"];

function projectKey(context: Pick<MemoryContext, "orgId" | "projectId">): string {
  return `${context.orgId}::${context.projectId}`;
}

function defaultSummarize(records: MemoryRecord[]): string {
  const lines = records.map((record) => {
    const compactContent = record.content.replace(/\s+/g, " ").trim();
    return `- [${record.id}] ${compactContent.slice(0, 240)}`;
  });
  return ["Archived memory summary", "", ...lines].join("\n");
}

export class MemorySummarizationPipeline {
  private readonly projects = new Map<string, ProjectConfigEntry>();
  private readonly now: () => Date;
  private readonly summarySourceToolId: string;
  private readonly summarize: (records: MemoryRecord[]) => string;

  constructor(
    private readonly store: MemoryStore,
    options?: MemorySummarizationPipelineOptions,
  ) {
    this.now = options?.now ?? (() => new Date());
    this.summarySourceToolId = options?.summarySourceToolId ?? "system:memory-summarizer";
    this.summarize = options?.summarize ?? defaultSummarize;
  }

  configureProject(
    context: Pick<MemoryContext, "orgId" | "projectId">,
    config: MemorySummarizationProjectConfig,
  ): void {
    if (!context.projectId) {
      throw new Error("Project memory summarization requires projectId");
    }

    if (config.scheduleMs <= 0) {
      throw new Error("scheduleMs must be > 0");
    }
    if (config.maxAgeMs <= 0) {
      throw new Error("maxAgeMs must be > 0");
    }

    const key = projectKey(context);
    this.stopProjectByKey(key);
    this.projects.set(key, {
      context: { orgId: context.orgId, projectId: context.projectId },
      config,
    });

    if (config.enabled) {
      this.startProjectByKey(key);
    }
  }

  removeProject(context: Pick<MemoryContext, "orgId" | "projectId">): void {
    const key = projectKey(context);
    this.stopProjectByKey(key);
    this.projects.delete(key);
  }

  start(): void {
    for (const key of this.projects.keys()) {
      this.startProjectByKey(key);
    }
  }

  stop(): void {
    for (const key of this.projects.keys()) {
      this.stopProjectByKey(key);
    }
  }

  async runNow(
    context: Pick<MemoryContext, "orgId" | "projectId">,
  ): Promise<MemorySummarizationRunResult> {
    if (!context.projectId) {
      throw new Error("Project memory summarization requires projectId");
    }

    const key = projectKey(context);
    const project = this.projects.get(key);
    if (!project || !project.config.enabled) {
      return {
        orgId: context.orgId,
        projectId: context.projectId,
        summarizedCount: 0,
        archivedCount: 0,
        skipped: true,
      };
    }

    const now = this.now();
    const minCreatedAt = now.getTime() - project.config.maxAgeMs;
    const scopes = project.config.scopes ?? DEFAULT_SCOPES;

    const candidates = (
      await Promise.all(
        scopes.map((scope) => this.store.listByScope(scope, project.context, { now })),
      )
    )
      .flat()
      .filter((record) => !isArchivedRecord(record))
      .filter((record) => new Date(record.createdAt).getTime() <= minCreatedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const minRecords = Math.max(1, project.config.minRecords ?? 3);
    if (candidates.length < minRecords) {
      return {
        orgId: context.orgId,
        projectId: context.projectId,
        summarizedCount: 0,
        archivedCount: 0,
        skipped: true,
      };
    }

    const summarizeCount = Math.max(1, project.config.maxRecordsPerSummary ?? candidates.length);
    const recordsToSummarize = candidates.slice(0, summarizeCount);
    const summaryContent = this.summarize(recordsToSummarize);
    const summaryScope = recordsToSummarize[0]?.scope ?? "project";

    const summary = await this.store.write({
      content: summaryContent,
      scope: summaryScope,
      context: project.context,
      category: "memory-summary",
      sourceToolId: this.summarySourceToolId,
      metadata: {
        summarizedAt: now.toISOString(),
        originalMemoryIds: recordsToSummarize.map((record) => record.id),
      },
      tags: ["summary", "archived"],
      now,
    });

    for (const record of recordsToSummarize) {
      const archiveContext: MemoryContext = {
        orgId: record.orgId,
        ...(record.projectId ? { projectId: record.projectId } : {}),
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      };

      await this.store.write({
        id: record.id,
        ...(record.key ? { key: record.key } : {}),
        content: record.content,
        scope: record.scope,
        context: archiveContext,
        ...(record.sourceToolId ? { sourceToolId: record.sourceToolId } : {}),
        metadata: {
          ...(record.metadata ?? {}),
          archived: true,
          archivedAt: now.toISOString(),
          summaryId: summary.id,
        },
        ...(record.tags ? { tags: record.tags } : {}),
        ...(record.category ? { category: record.category } : {}),
        now,
      });
    }

    return {
      orgId: context.orgId,
      projectId: context.projectId,
      summarizedCount: recordsToSummarize.length,
      archivedCount: recordsToSummarize.length,
      summaryId: summary.id,
      skipped: false,
    };
  }

  private startProjectByKey(key: string): void {
    const project = this.projects.get(key);
    if (!project || !project.config.enabled || project.timer) {
      return;
    }

    project.timer = setInterval(() => {
      void this.runNow(project.context);
    }, project.config.scheduleMs);
  }

  private stopProjectByKey(key: string): void {
    const project = this.projects.get(key);
    if (project?.timer) {
      clearInterval(project.timer);
      delete project.timer;
    }
  }
}

function isArchivedRecord(record: MemoryRecord): boolean {
  const metadata = record.metadata as { archived?: boolean } | undefined;
  return metadata?.archived === true;
}
