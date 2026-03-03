/**
 * Policy module exports.
 */

export type {
  ActionHookContext,
  ActionHookDefinition,
  ActionHookPhase,
  ExecuteActionWithHooksOptions,
  HookAllowResult,
  HookVetoResult,
  PostActionHook,
  PostActionHookContext,
  PreActionHook,
  PreActionHookResult,
} from "./action-hooks.js";
export {
  ActionHookExecutionError,
  executeActionWithHooks,
  PreActionVetoError,
} from "./action-hooks.js";
export type {
  ApprovalDecisionStatus,
  ApprovalEnforcementStatus,
  ApprovalGateConfig,
  ApprovalGateCreateInput,
  ApprovalGateDecisionInput,
  ApprovalGateEvaluateInput,
  ApprovalGateEvaluateResult,
  ApprovalGateRequest,
  ApprovalPolicyEvaluationResult,
} from "./approval-gate.js";
export {
  ApprovalGateService,
  createApprovalGateService,
  evaluatePolicyWithApprovalGate,
} from "./approval-gate.js";
export type { ConditionalDimensions } from "./condition-evaluator.js";
export { conditionsMatch, deriveConditionalDimensions } from "./condition-evaluator.js";
export type {
  Actor,
  EvaluationContext,
  PolicyScope,
  Resource,
  ScopeChainEntry,
} from "./evaluation-context.js";
export { createEvaluationContext } from "./evaluation-context.js";
export type {
  EmergencyKillSwitchConfig,
  KillSwitchActivationInput,
  KillSwitchDeactivationInput,
  KillSwitchEnforcementInput,
  KillSwitchState,
  KillSwitchStatus,
} from "./kill-switch.js";
export {
  createEmergencyKillSwitch,
  EmergencyKillSwitch,
  KillSwitchBlockedError,
} from "./kill-switch.js";
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
  PolicyRiskLevel,
} from "./policy-evaluator.js";
export {
  createFailClosedEvaluator,
  createFailOpenEvaluator,
  PolicyEvaluator,
  resolveInheritedPolicies,
} from "./policy-evaluator.js";
export type { PolicyMatchContext } from "./policy-matcher.js";
export { matchesGlob, matchesRule } from "./policy-matcher.js";
export type {
  PolicyCondition as CanonicalPolicyCondition,
  PolicyDocument as CanonicalPolicyDocument,
  PolicyEffect as CanonicalPolicyEffect,
  PolicyRiskLevel as CanonicalPolicyRiskLevel,
  PolicyRule as CanonicalPolicyRule,
  PolicyScope as CanonicalPolicyScope,
} from "./policy-schema.js";
export {
  PolicyConditionSchema,
  PolicyDocumentSchema,
  PolicyEffectSchema,
  PolicyRiskLevelSchema,
  PolicyRuleSchema,
  PolicyScopeSchema,
} from "./policy-schema.js";
export type { ValidationResult as PolicyValidationResult } from "./policy-validator.js";
export {
  validatePolicyDocument,
  validatePolicyJson,
  validatePolicyYaml,
} from "./policy-validator.js";
export type { BuiltInRole, RolePolicyOptions } from "./rbac.js";
export {
  BUILT_IN_ROLES,
  BuiltInRoleSchema,
  createIdentityRolePolicies,
  createRolePolicies,
  resolveBuiltInRoles,
  resolveIdentityRoles,
} from "./rbac.js";
