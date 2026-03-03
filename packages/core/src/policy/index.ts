/**
 * Policy Module
 */

export type {
  Actor,
  EvaluationContext,
  PolicyScope,
  Resource,
  ScopeChainEntry,
} from "./evaluation-context.js";
export { createEvaluationContext } from "./evaluation-context.js";
export type { PermissionAuditLoggerConfig } from "./permission-audit.js";
export {
  createPermissionAuditLogger,
  evaluatePolicyWithAudit,
  PermissionAuditLogger,
  permissionEvaluation,
} from "./permission-audit.js";

export type {
  MatchedRule,
  PermissionAuditEntry,
  PermissionAuditFilter,
  PermissionAuditInput,
  PermissionAuditPage,
  PermissionAuditStats,
  PermissionResult,
} from "./permission-audit-types.js";
export {
  MatchedRuleSchema,
  PermissionAuditEntrySchema,
  PermissionResultSchema,
} from "./permission-audit-types.js";
export type {
  DefaultEffect,
  EvaluationReason,
  EvaluationResult,
  Policy,
  PolicyCondition,
  PolicyEffect,
  PolicyEvaluatorConfig,
} from "./policy-evaluator.js";
export {
  createFailClosedEvaluator,
  createFailOpenEvaluator,
  PolicyEvaluator,
} from "./policy-evaluator.js";
