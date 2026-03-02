/**
 * Policy Module
 *
 * Provides policy evaluation for the LAUP permission system.
 *
 * ## PERM-004: Policy Evaluation Order
 *
 * ### Effect Priority
 * - Explicit deny > explicit allow
 * - If any policy denies, access is denied
 *
 * ### Scope Priority (highest to lowest)
 * 1. org - Organization-wide policies
 * 2. team - Team-level policies
 * 3. project - Project-specific policies
 * 4. user - User-specific policies
 *
 * Higher scopes override lower scopes.
 *
 * ### Default Behavior
 * - Fail-closed (deny) is the default for new organizations
 * - Fail-open (allow) can be configured but is not recommended
 *
 * @example
 * ```ts
 * import {
 *   PolicyEvaluator,
 *   createEvaluationContext,
 *   type Policy,
 * } from "@laup/core/policy";
 *
 * const evaluator = new PolicyEvaluator({ defaultEffect: "deny" });
 *
 * const context = createEvaluationContext(
 *   { id: "user-1", type: "user" },
 *   "read",
 *   { type: "document" },
 *   [
 *     { scope: "user", id: "user-1" },
 *     { scope: "project", id: "proj-1" },
 *     { scope: "org", id: "org-1" },
 *   ]
 * );
 *
 * const policies: Policy[] = [
 *   {
 *     id: "pol-1",
 *     name: "Allow org read",
 *     scope: "org",
 *     scopeId: "org-1",
 *     effect: "allow",
 *     actions: ["read"],
 *     resourceTypes: ["document"],
 *   },
 * ];
 *
 * const result = evaluator.evaluate(context, policies);
 * console.log(result.allowed); // true
 * ```
 */

export type {
  Actor,
  EvaluationContext,
  PolicyScope,
  Resource,
  ScopeChainEntry,
} from "./evaluation-context.js";
export { createEvaluationContext } from "./evaluation-context.js";

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
export type { PolicyMatchContext } from "./policy-matcher.js";
export { matchesGlob, matchesRule } from "./policy-matcher.js";
export type {
  PolicyCondition as CanonicalPolicyCondition,
  PolicyDocument as CanonicalPolicyDocument,
  PolicyEffect as CanonicalPolicyEffect,
  PolicyRule as CanonicalPolicyRule,
  PolicyScope as CanonicalPolicyScope,
} from "./policy-schema.js";
export {
  PolicyConditionSchema,
  PolicyDocumentSchema,
  PolicyEffectSchema,
  PolicyRuleSchema,
  PolicyScopeSchema,
} from "./policy-schema.js";

export type { ValidationResult as PolicyValidationResult } from "./policy-validator.js";
export {
  validatePolicyDocument,
  validatePolicyJson,
  validatePolicyYaml,
} from "./policy-validator.js";
