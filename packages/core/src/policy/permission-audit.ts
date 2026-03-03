/**
 * Permission audit logger (PERM-005).
 * Produces immutable audit log entries for every permission evaluation.
 * Builds on the existing AuditStorage infrastructure (INFRA-004).
 */

import type { AuditEntry, AuditQueryFilter, AuditStorage } from "../audit-storage.js";
import type { EvaluationContext } from "./evaluation-context.js";
import type {
  PermissionAuditEntry,
  PermissionAuditFilter,
  PermissionAuditInput,
  PermissionAuditPage,
  PermissionAuditStats,
  PermissionResult,
} from "./permission-audit-types.js";
import type { EvaluationResult, Policy, PolicyEvaluator } from "./policy-evaluator.js";

/**
 * Permission audit logger configuration.
 */
export interface PermissionAuditLoggerConfig {
  /**
   * Minimum retention period in months.
   * Entries older than this may be archived but not deleted.
   * Default: 24 months (compliance requirement).
   */
  retentionMonths?: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: Required<PermissionAuditLoggerConfig> = {
  retentionMonths: 24,
};

/**
 * Permission audit logger.
 * Logs all permission evaluations to the audit storage for compliance.
 */
export class PermissionAuditLogger {
  private readonly config: Required<PermissionAuditLoggerConfig>;

  constructor(
    private readonly storage: AuditStorage,
    config: PermissionAuditLoggerConfig = {},
  ) {
    this.config = {
      retentionMonths: Math.max(config.retentionMonths ?? DEFAULT_CONFIG.retentionMonths, 24),
    };
  }

  /**
   * Initialize the logger.
   * Should be called once before using the logger.
   */
  async init(): Promise<void> {
    await this.storage.init();
  }

  /**
   * Log a permission evaluation.
   */
  async logEvaluation(entry: PermissionAuditInput): Promise<string> {
    return this.storage.append(this.toAuditEntry(entry));
  }

  /**
   * Log multiple permission evaluations atomically.
   */
  async logEvaluationBatch(entries: PermissionAuditInput[]): Promise<string[]> {
    return this.storage.appendBatch(entries.map((entry) => this.toAuditEntry(entry)));
  }

  /**
   * Query permission audit entries.
   */
  async query(
    filter: PermissionAuditFilter,
    limit = 100,
    offset = 0,
  ): Promise<PermissionAuditPage> {
    // Base filters done by storage, metadata filters applied in-memory.
    const auditFilter = this.toAuditFilter(filter);
    const pageSize = 250;
    let scanOffset = 0;
    const matches: PermissionAuditEntry[] = [];

    while (true) {
      const page = await this.storage.query(auditFilter, pageSize, scanOffset);
      const converted = page.entries
        .map((entry) => this.fromAuditEntry(entry))
        .filter((entry): entry is PermissionAuditEntry => entry !== null)
        .filter((entry) => this.matchesFilter(entry, filter));

      matches.push(...converted);

      if (!page.hasMore) {
        break;
      }

      scanOffset += pageSize;
    }

    return {
      entries: matches.slice(offset, offset + limit),
      total: matches.length,
      limit,
      offset,
      hasMore: offset + limit < matches.length,
    };
  }

  /**
   * Get a single audit entry by ID.
   */
  async get(id: string): Promise<PermissionAuditEntry | null> {
    const entry = await this.storage.get(id);
    if (!entry) {
      return null;
    }

    return this.fromAuditEntry(entry);
  }

  /**
   * Get all audit entries for a correlation ID.
   */
  async getByCorrelation(correlationId: string): Promise<PermissionAuditEntry[]> {
    const entries = await this.storage.getByCorrelation(correlationId);
    return entries
      .map((entry) => this.fromAuditEntry(entry))
      .filter((entry): entry is PermissionAuditEntry => entry !== null);
  }

  /**
   * Get audit statistics.
   */
  async stats(filter: PermissionAuditFilter = {}): Promise<PermissionAuditStats> {
    const page = await this.query(filter, 10_000, 0);

    const stats: PermissionAuditStats = {
      totalEvaluations: page.entries.length,
      allowCount: 0,
      denyCount: 0,
      byActor: {},
      byAction: {},
      byTool: {},
    };

    for (const entry of page.entries) {
      if (entry.result === "allow") {
        stats.allowCount += 1;
      } else {
        stats.denyCount += 1;
      }

      stats.byActor[entry.actor] = (stats.byActor[entry.actor] ?? 0) + 1;
      stats.byAction[entry.action] = (stats.byAction[entry.action] ?? 0) + 1;

      if (entry.tool) {
        stats.byTool[entry.tool] = (stats.byTool[entry.tool] ?? 0) + 1;
      }

      if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry) {
        stats.oldestEntry = entry.timestamp;
      }

      if (!stats.newestEntry || entry.timestamp > stats.newestEntry) {
        stats.newestEntry = entry.timestamp;
      }
    }

    return stats;
  }

  /**
   * Get the minimum retention date.
   * Entries before this date may be archived by infrastructure policies.
   */
  getRetentionCutoff(): Date {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - this.config.retentionMonths);
    return cutoff;
  }

  /**
   * Verify audit log integrity.
   */
  async verifyIntegrity(): Promise<{ valid: boolean; issues: string[] }> {
    return this.storage.verifyIntegrity();
  }

  private toAuditEntry(entry: PermissionAuditInput): Omit<AuditEntry, "id" | "timestamp"> {
    return {
      category: "access",
      action: `permission.${entry.action}`,
      actor: entry.actor,
      targetId: entry.resource,
      targetType: entry.resourceType ?? "resource",
      severity: entry.result === "deny" ? "warning" : "info",
      reason: entry.reason,
      correlationId: entry.correlationId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      metadata: {
        permissionAction: entry.action,
        result: entry.result,
        tool: entry.tool,
        matchedRule: entry.matchedRule,
        context: entry.context,
      },
    };
  }

  private fromAuditEntry(entry: AuditEntry): PermissionAuditEntry | null {
    if (entry.category !== "access") {
      return null;
    }

    const metadata = entry.metadata;
    if (!metadata) {
      return null;
    }

    const result = metadata["result"];
    if (result !== "allow" && result !== "deny") {
      return null;
    }

    return {
      id: entry.id,
      actor: entry.actor,
      action: this.extractAction(entry, metadata["permissionAction"]),
      resource: entry.targetId ?? "",
      resourceType: entry.targetType,
      tool: typeof metadata["tool"] === "string" ? metadata["tool"] : undefined,
      matchedRule: isObject(metadata["matchedRule"])
        ? (metadata["matchedRule"] as PermissionAuditEntry["matchedRule"])
        : undefined,
      result,
      timestamp: entry.timestamp,
      reason: entry.reason,
      correlationId: entry.correlationId,
      context: isObject(metadata["context"])
        ? (metadata["context"] as PermissionAuditEntry["context"])
        : undefined,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    };
  }

  private extractAction(entry: AuditEntry, metadataAction: unknown): string {
    if (typeof metadataAction === "string") {
      return metadataAction;
    }

    if (entry.action.startsWith("permission.")) {
      return entry.action.slice("permission.".length);
    }

    return entry.action;
  }

  private toAuditFilter(filter: PermissionAuditFilter): AuditQueryFilter {
    const auditFilter: AuditQueryFilter = { category: "access" };

    if (filter.actor) {
      auditFilter.actor = filter.actor;
    }

    if (filter.action) {
      auditFilter.action = `permission.${filter.action}`;
    }

    if (filter.resource) {
      auditFilter.targetId = filter.resource;
    }

    if (filter.correlationId) {
      auditFilter.correlationId = filter.correlationId;
    }

    if (filter.startTime) {
      auditFilter.startTime = filter.startTime;
    }

    if (filter.endTime) {
      auditFilter.endTime = filter.endTime;
    }

    return auditFilter;
  }

  private matchesFilter(entry: PermissionAuditEntry, filter: PermissionAuditFilter): boolean {
    if (filter.result && entry.result !== filter.result) return false;
    if (filter.tool && entry.tool !== filter.tool) return false;
    if (filter.ruleId && entry.matchedRule?.ruleId !== filter.ruleId) return false;
    if (filter.resourcePrefix && !entry.resource.startsWith(filter.resourcePrefix)) return false;
    return true;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Create a permission audit logger with the given storage.
 */
export function createPermissionAuditLogger(
  storage: AuditStorage,
  config?: PermissionAuditLoggerConfig,
): PermissionAuditLogger {
  return new PermissionAuditLogger(storage, config);
}

/**
 * Helper to create a permission evaluation log entry.
 */
export function permissionEvaluation(
  actor: string,
  action: string,
  resource: string,
  result: PermissionResult,
  options: Partial<Omit<PermissionAuditInput, "actor" | "action" | "resource" | "result">> = {},
): PermissionAuditInput {
  return {
    actor,
    action,
    resource,
    result,
    ...options,
  };
}

/**
 * Adapter helper to evaluate a policy decision and emit an audit entry.
 */
export async function evaluatePolicyWithAudit(
  evaluator: PolicyEvaluator,
  context: EvaluationContext,
  policies: Policy[],
  auditLogger: PermissionAuditLogger,
  options: {
    tool?: string;
    correlationId?: string;
    ipAddress?: string;
    userAgent?: string;
    context?: Record<string, unknown>;
  } = {},
): Promise<EvaluationResult> {
  const result = evaluator.evaluate(context, policies);
  const matchedPolicyId = result.reason.matchedPolicyId;

  await auditLogger.logEvaluation({
    actor: context.actor.id,
    action: context.action,
    resource: context.resource.id ?? context.resource.type,
    resourceType: context.resource.type,
    tool: options.tool,
    result: result.allowed ? "allow" : "deny",
    matchedRule: matchedPolicyId
      ? {
          ruleId: matchedPolicyId,
          priority: undefined,
          source: "policy-evaluator",
          metadata: {
            matchedScope: result.reason.matchedScope,
          },
        }
      : undefined,
    reason: matchedPolicyId ? "matched policy" : "no matching policy",
    correlationId: options.correlationId,
    context: {
      matchedPolicyId,
      matchedScope: result.reason.matchedScope,
      usedDefault: result.reason.usedDefault,
      denyCount: result.reason.denyCount,
      allowCount: result.reason.allowCount,
      allMatchedPolicyIds: result.reason.allMatchedPolicyIds,
      ...options.context,
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
  });

  return result;
}
