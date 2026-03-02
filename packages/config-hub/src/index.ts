import { EventEmitter } from "node:events";
import { existsSync, type FSWatcher, readFileSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CanonicalInstruction, ToolAdapter, ValidationResult } from "@laup/core";
import { parseCanonical, validateCanonical } from "@laup/core";
import { computeDiff, type DiffResult } from "./diff.js";

export type { ValidationResult };
export type { AuditQuery, DocumentAuditRecord, DocumentChangeAction } from "./audit-history.js";
export { DocumentAuditHistory } from "./audit-history.js";
export type { DiffLine, DiffResult } from "./diff.js";
export { computeDiff, formatDiff } from "./diff.js";
export type {
  ConflictError,
  UpdateRequest,
  VersionedDocument,
} from "./optimistic-locking.js";
export {
  VersionConflict,
  VersionedDocumentStore,
} from "./optimistic-locking.js";
export type {
  DeliveryResult,
  WebhookEvent,
  WebhookEventType,
  WebhookRegistration,
  WebhookSender,
} from "./webhooks.js";
export {
  WebhookDispatcher,
  WebhookRegistry,
} from "./webhooks.js";

export interface SyncResult {
  tool: string;
  success: boolean;
  paths: string[];
  error?: string;
}

export interface PreviewResult {
  tool: string;
  success: boolean;
  /** Rendered content for each output file. Array for tools with multiple outputs. */
  content: string[];
  error?: string;
}

export interface DiffPreviewResult {
  tool: string;
  success: boolean;
  /** Per-file diff results with path and diff */
  files: Array<{
    path: string;
    exists: boolean;
    diff: DiffResult;
  }>;
  error?: string;
}

export interface SyncOptions {
  /** Absolute or relative path to the canonical instruction file. */
  source: string;
  /** Tool IDs to sync. Pass empty array to sync all registered adapters. */
  tools: string[];
  /** Target directory for output files. Defaults to source file's directory. */
  outputDir?: string;
  /** When true, skip writing files and return what would be written. */
  dryRun?: boolean;
}

export interface SyncDocumentOptions {
  /** Pre-parsed/merged canonical instruction document. */
  document: CanonicalInstruction;
  /** Tool IDs to sync. Pass empty array to sync all registered adapters. */
  tools: string[];
  /** Target directory for output files. Required. */
  outputDir: string;
  /** When true, skip writing files and return what would be written. Default: false. */
  dryRun?: boolean | undefined;
}

export interface WatchOptions {
  /** Absolute or relative path to the canonical instruction file to watch. */
  source: string;
  /** Tool IDs to sync on change. Pass empty array to sync all registered adapters. */
  tools: string[];
  /** Target directory for output files. Defaults to the source file's directory. */
  outputDir?: string;
  /** Maximum number of retry attempts after an initial failure. Default: 3. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential-backoff retries. Default: 1000. */
  retryBaseMs?: number;
  /** Debounce window in milliseconds to coalesce rapid file-change events. Default: 50. */
  debounceMs?: number;
}

/** Emitted by Watcher after each propagation attempt (success or failure). */
export interface PropagationRecord {
  /** Wall-clock timestamp when this propagation attempt started (ms since epoch). */
  startedAt: number;
  /** Total latency of this propagation attempt in milliseconds. */
  latencyMs: number;
  /** 1-indexed attempt number (1 = initial, 2+ = retries). */
  attempt: number;
  /** True if all adapters propagated successfully on this attempt. */
  success: boolean;
  /** Per-adapter sync results. Empty array when engine.sync() threw before any adapter ran. */
  results: SyncResult[];
  /** Error message when success is false. */
  error?: string;
}

export class SyncEngine {
  private adapters: Map<string, ToolAdapter>;

  constructor(adapters: ToolAdapter[]) {
    this.adapters = new Map(adapters.map((a) => [a.toolId, a]));
  }

  get registeredTools(): string[] {
    return [...this.adapters.keys()];
  }

  validate(source: string): ValidationResult {
    const content = readFileSync(resolve(source), "utf-8");
    return validateCanonical(content);
  }

  sync(options: SyncOptions): SyncResult[] {
    const sourcePath = resolve(options.source);
    const targetDir = options.outputDir ?? dirname(sourcePath);
    const doc = parseCanonical(sourcePath);

    return this.syncDocument({
      document: doc,
      tools: options.tools,
      outputDir: targetDir,
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    });
  }

  /**
   * Sync a pre-parsed/merged document to tool-specific output files.
   * Useful when merging documents from multiple scopes before syncing.
   */
  syncDocument(options: SyncDocumentOptions): SyncResult[] {
    const toolIds = options.tools.length > 0 ? options.tools : this.registeredTools;
    const dryRun = options.dryRun ?? false;
    const results: SyncResult[] = [];

    for (const toolId of toolIds) {
      const adapter = this.adapters.get(toolId);
      if (!adapter) {
        results.push({
          tool: toolId,
          success: false,
          paths: [],
          error: `No adapter registered for tool: ${toolId}`,
        });
        continue;
      }

      try {
        const rendered = adapter.render(options.document);
        const paths = dryRun ? [] : adapter.write(rendered, options.outputDir);
        results.push({ tool: toolId, success: true, paths });
      } catch (err) {
        results.push({
          tool: toolId,
          success: false,
          paths: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Preview rendered output for each tool without writing files.
   * Returns the rendered content for inspection/display (CONF-016).
   */
  preview(document: CanonicalInstruction, tools: string[] = []): PreviewResult[] {
    const toolIds = tools.length > 0 ? tools : this.registeredTools;
    const results: PreviewResult[] = [];

    for (const toolId of toolIds) {
      const adapter = this.adapters.get(toolId);
      if (!adapter) {
        results.push({
          tool: toolId,
          success: false,
          content: [],
          error: `No adapter registered for tool: ${toolId}`,
        });
        continue;
      }

      try {
        const rendered = adapter.render(document);
        // Normalize to array for consistent handling
        const contentArray = Array.isArray(rendered) ? rendered : [rendered];
        results.push({ tool: toolId, success: true, content: contentArray });
      } catch (err) {
        results.push({
          tool: toolId,
          success: false,
          content: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Preview with diff: compare rendered output against existing files (CONF-020).
   * Returns per-file diff results showing what would change.
   */
  previewWithDiff(
    document: CanonicalInstruction,
    outputDir: string,
    tools: string[] = [],
  ): DiffPreviewResult[] {
    const toolIds = tools.length > 0 ? tools : this.registeredTools;
    const results: DiffPreviewResult[] = [];

    for (const toolId of toolIds) {
      const adapter = this.adapters.get(toolId);
      if (!adapter) {
        results.push({
          tool: toolId,
          success: false,
          files: [],
          error: `No adapter registered for tool: ${toolId}`,
        });
        continue;
      }

      try {
        const rendered = adapter.render(document);
        const contentArray = Array.isArray(rendered) ? rendered : [rendered];

        // Get expected output paths
        const paths = adapter.getOutputPaths
          ? adapter.getOutputPaths(outputDir)
          : this.inferPaths(toolId, outputDir, contentArray.length);

        const files: DiffPreviewResult["files"] = [];

        for (let i = 0; i < contentArray.length; i++) {
          const filePath = paths[i] ?? join(outputDir, `${toolId}-output-${i}`);
          const newContent = contentArray[i] ?? "";

          const fileExists = existsSync(filePath);
          const oldContent = fileExists ? readFileSync(filePath, "utf-8") : "";

          const diff = computeDiff(oldContent, newContent);
          files.push({ path: filePath, exists: fileExists, diff });
        }

        results.push({ tool: toolId, success: true, files });
      } catch (err) {
        results.push({
          tool: toolId,
          success: false,
          files: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /** Fallback path inference for adapters without getOutputPaths */
  private inferPaths(toolId: string, outputDir: string, count: number): string[] {
    // Known conventions for common tools
    const conventions: Record<string, string[]> = {
      cursor: [join(outputDir, ".cursorrules"), join(outputDir, ".cursor", "rules", "laup.mdc")],
      "claude-code": [join(outputDir, "CLAUDE.md")],
      aider: [join(outputDir, ".aider.conf.yml"), join(outputDir, "CONVENTIONS.md")],
    };

    if (conventions[toolId]) {
      return conventions[toolId];
    }

    // Generic fallback
    return Array.from({ length: count }, (_, i) => join(outputDir, `${toolId}-output-${i}`));
  }
}

/**
 * Watches a canonical instruction file for changes and propagates updates to
 * all registered tool adapters. Emits 'propagated' on each sync attempt and
 * 'error' after exhausting all retry attempts.
 *
 * Satisfies CONF-003: detection + propagation completes well within the 30-second
 * SLO (file-change events fire in < 100 ms; sync is synchronous); failures are
 * retried with exponential backoff; latency is observable via the 'propagated' event.
 */
export class Watcher extends EventEmitter {
  private readonly engine: SyncEngine;
  private readonly source: string;
  private readonly tools: string[];
  private readonly outputDir: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly debounceMs: number;
  private fsWatcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: SyncEngine, options: WatchOptions) {
    super();
    this.engine = engine;
    this.source = resolve(options.source);
    this.tools = options.tools;
    this.outputDir = options.outputDir ?? dirname(resolve(options.source));
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.debounceMs = options.debounceMs ?? 50;
  }

  /** Start watching the source file. Idempotent — calling twice has no effect. */
  start(): void {
    if (this.fsWatcher !== null) return;
    this.fsWatcher = watch(this.source, () => {
      this.handleChange();
    });
  }

  /** Stop watching and cancel any pending debounce or retry timers. */
  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.fsWatcher !== null) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  /**
   * Programmatically trigger a debounced sync. Equivalent to a file-change event.
   * Useful for manual sync requests from the CLI and for testing.
   */
  triggerSync(): void {
    this.handleChange();
  }

  private handleChange(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.propagate(1, this.tools);
    }, this.debounceMs);
  }

  private async propagate(attempt: number, toolIds: string[]): Promise<void> {
    const startedAt = Date.now();
    let results: SyncResult[] = [];

    try {
      results = this.engine.sync({
        source: this.source,
        tools: toolIds,
        outputDir: this.outputDir,
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const error = err instanceof Error ? err.message : String(err);
      const record: PropagationRecord = {
        startedAt,
        latencyMs,
        attempt,
        success: false,
        results: [],
        error,
      };
      this.emit("propagated", record);
      this.scheduleRetry(attempt, toolIds, err);
      return;
    }

    const latencyMs = Date.now() - startedAt;
    const failed = results.filter((r) => !r.success);

    if (failed.length === 0) {
      const record: PropagationRecord = { startedAt, latencyMs, attempt, success: true, results };
      this.emit("propagated", record);
    } else {
      const error = `${failed.length} adapter(s) failed to propagate`;
      const record: PropagationRecord = {
        startedAt,
        latencyMs,
        attempt,
        success: false,
        results,
        error,
      };
      this.emit("propagated", record);
      const failedToolIds = failed.map((r) => r.tool);
      this.scheduleRetry(attempt, failedToolIds, new Error(error));
    }
  }

  /**
   * Schedule the next retry attempt with exponential backoff.
   * If attempt > maxRetries, emit 'error' instead of retrying.
   */
  private scheduleRetry(attempt: number, toolIds: string[], err: unknown): void {
    if (attempt > this.maxRetries) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const delay = this.retryBaseMs * 2 ** (attempt - 1);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.propagate(attempt + 1, toolIds);
    }, delay);
  }
}
