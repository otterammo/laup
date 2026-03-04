import type { McpServer } from "./mcp-schema.js";
import { validateMcpServer } from "./mcp-schema.js";

export interface McpPropagationTarget {
  /** Tool identifier that receives MCP server configuration. */
  toolId: string;

  /** Human-readable tool name for status output. */
  displayName?: string;

  /**
   * Propagate one MCP server registration into this tool's config surface.
   * Should be idempotent for same server input.
   */
  propagate(server: McpServer): void | Promise<void>;
}

export interface McpPropagationTargetStatus {
  toolId: string;
  displayName: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface McpPropagationReport {
  serverId: string;
  startedAt: number;
  completedAt: number;
  totalDurationMs: number;
  targetSloMs: number;
  withinSlo: boolean;
  successCount: number;
  failureCount: number;
  targets: McpPropagationTargetStatus[];
}

export interface McpPropagationOptions {
  /** Global target SLO. Default: 30_000ms */
  targetSloMs?: number;

  /** Per-target timeout. Default: same as targetSloMs. */
  perTargetTimeoutMs?: number;

  /** Injectable time source for tests. */
  now?: () => number;
}

export interface McpSloMeasurement {
  targetMs: number;
  observedMs: number;
  withinSlo: boolean;
  budgetRemainingMs: number;
}

/**
 * MCP-001 propagation service.
 * Accepts a single registration and fans it out to all MCP-capable targets.
 */
export class McpPropagationService {
  private readonly targets: McpPropagationTarget[];
  private readonly targetSloMs: number;
  private readonly perTargetTimeoutMs: number;
  private readonly now: () => number;

  constructor(targets: McpPropagationTarget[], options: McpPropagationOptions = {}) {
    this.targets = [...targets];
    this.targetSloMs = options.targetSloMs ?? 30_000;
    this.perTargetTimeoutMs = options.perTargetTimeoutMs ?? this.targetSloMs;
    this.now = options.now ?? Date.now;
  }

  async propagateRegistration(server: McpServer): Promise<McpPropagationReport> {
    const validation = validateMcpServer(server);
    if (!validation.valid || !validation.server) {
      const issues = validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      throw new Error(`Invalid MCP server registration: ${issues}`);
    }

    const canonicalServer = validation.server;
    const startedAt = this.now();

    const statuses = await Promise.all(
      this.targets.map(async (target) => {
        const targetStartedAt = this.now();
        const displayName = target.displayName ?? target.toolId;

        try {
          await withTimeout(
            target.propagate(canonicalServer),
            this.perTargetTimeoutMs,
            target.toolId,
          );
          return {
            toolId: target.toolId,
            displayName,
            success: true,
            durationMs: this.now() - targetStartedAt,
          } satisfies McpPropagationTargetStatus;
        } catch (error) {
          return {
            toolId: target.toolId,
            displayName,
            success: false,
            durationMs: this.now() - targetStartedAt,
            error: error instanceof Error ? error.message : String(error),
          } satisfies McpPropagationTargetStatus;
        }
      }),
    );

    const completedAt = this.now();
    const totalDurationMs = completedAt - startedAt;
    const successCount = statuses.filter((s) => s.success).length;
    const failureCount = statuses.length - successCount;
    const withinSlo = totalDurationMs <= this.targetSloMs;

    return {
      serverId: canonicalServer.id,
      startedAt,
      completedAt,
      totalDurationMs,
      targetSloMs: this.targetSloMs,
      withinSlo,
      successCount,
      failureCount,
      targets: statuses,
    };
  }
}

/**
 * SLO instrumentation helper for MCP propagation latency checks.
 */
export function measureMcpPropagationSlo(
  report: Pick<McpPropagationReport, "totalDurationMs" | "targetSloMs">,
): McpSloMeasurement {
  return {
    targetMs: report.targetSloMs,
    observedMs: report.totalDurationMs,
    withinSlo: report.totalDurationMs <= report.targetSloMs,
    budgetRemainingMs: report.targetSloMs - report.totalDurationMs,
  };
}

async function withTimeout(
  work: void | Promise<void>,
  timeoutMs: number,
  toolId: string,
): Promise<void> {
  await Promise.race([
    Promise.resolve(work),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Propagation timed out for ${toolId} after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}
