/**
 * Permission audit types (PERM-005).
 * Type definitions for permission evaluation audit logging.
 */

import { z } from "zod";

/**
 * Permission evaluation result.
 */
export const PermissionResultSchema = z.enum(["allow", "deny"]);

export type PermissionResult = z.infer<typeof PermissionResultSchema>;

/**
 * Matched rule information captured during evaluation.
 */
export const MatchedRuleSchema = z.object({
  /** Rule identifier */
  ruleId: z.string(),
  /** Rule name/description */
  ruleName: z.string().optional(),
  /** Priority/order of the rule */
  priority: z.number().optional(),
  /** Source of the rule (e.g., policy file, config) */
  source: z.string().optional(),
  /** Additional rule metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MatchedRule = z.infer<typeof MatchedRuleSchema>;

/**
 * Permission audit entry schema.
 * Records every permission evaluation for compliance and debugging.
 */
export const PermissionAuditEntrySchema = z.object({
  /** Unique audit entry ID */
  id: z.string(),
  /** Actor requesting the permission (user, agent, system) */
  actor: z.string(),
  /** Action being evaluated (read, write, execute, etc.) */
  action: z.string(),
  /** Resource being accessed */
  resource: z.string(),
  /** Resource type (optional categorization) */
  resourceType: z.string().optional(),
  /** Tool requesting the permission (optional) */
  tool: z.string().optional(),
  /** The rule that matched and determined the result */
  matchedRule: MatchedRuleSchema.optional(),
  /** Evaluation result */
  result: PermissionResultSchema,
  /** ISO 8601 timestamp of the evaluation */
  timestamp: z.string(),
  /** Reason for the decision (e.g., "no matching rule", "explicit deny") */
  reason: z.string().optional(),
  /** Request context (e.g., session ID, correlation ID) */
  correlationId: z.string().optional(),
  /** Additional evaluation context */
  context: z.record(z.string(), z.unknown()).optional(),
  /** IP address of the requester (if available) */
  ipAddress: z.string().optional(),
  /** User agent (if available) */
  userAgent: z.string().optional(),
});

export type PermissionAuditEntry = z.infer<typeof PermissionAuditEntrySchema>;

/**
 * Input for logging a permission evaluation (without auto-generated fields).
 */
export type PermissionAuditInput = Omit<PermissionAuditEntry, "id" | "timestamp">;

/**
 * Filter for querying permission audit entries.
 */
export interface PermissionAuditFilter {
  /** Filter by actor */
  actor?: string;

  /** Filter by action */
  action?: string;

  /** Filter by resource (exact match) */
  resource?: string;

  /** Filter by resource prefix (wildcard match) */
  resourcePrefix?: string;

  /** Filter by tool */
  tool?: string;

  /** Filter by result */
  result?: PermissionResult;

  /** Filter by matched rule ID */
  ruleId?: string;

  /** Start time (inclusive) */
  startTime?: Date;

  /** End time (exclusive) */
  endTime?: Date;

  /** Filter by correlation ID */
  correlationId?: string;
}

/**
 * Pagination result for permission audit queries.
 */
export interface PermissionAuditPage {
  entries: PermissionAuditEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Statistics for permission audits.
 */
export interface PermissionAuditStats {
  totalEvaluations: number;
  allowCount: number;
  denyCount: number;
  byActor: Record<string, number>;
  byAction: Record<string, number>;
  byTool: Record<string, number>;
  oldestEntry?: string;
  newestEntry?: string;
}
