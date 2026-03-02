/**
 * Policy Evaluator
 *
 * PERM-004: Evaluates permission rules in documented priority order
 * with configurable fail-closed/fail-open default.
 *
 * ## Rule Evaluation Order
 *
 * 1. **Effect Priority**: Explicit deny > explicit allow
 *    - If any matching policy denies, the result is deny
 *    - Only if no denies and at least one allow, the result is allow
 *
 * 2. **Scope Priority**: org > team > project > user
 *    - Higher scopes take precedence over lower scopes
 *    - An org-level deny overrides a project-level allow
 *
 * 3. **Default Behavior**: Configurable per organization
 *    - fail-closed (deny): Default for new organizations
 *    - fail-open (allow): Must be explicitly configured
 *
 * Evaluation is consistent and deterministic - the same context and
 * policies will always produce the same result.
 */

import type { EvaluationContext, PolicyScope } from "./evaluation-context.js";

/**
 * The effect of a policy rule.
 * - 'allow': Grants access if matched
 * - 'deny': Denies access if matched (takes priority over allow)
 */
export type PolicyEffect = "allow" | "deny";

/**
 * The default effect when no policies match.
 * - 'deny': Fail-closed (secure by default, recommended)
 * - 'allow': Fail-open (permissive, use with caution)
 */
export type DefaultEffect = "deny" | "allow";

/**
 * Policy condition for matching against context.
 */
export interface PolicyCondition {
  /** Field path in the context to check (e.g., "actor.type", "resource.attributes.owner") */
  field: string;
  /** Operator for comparison */
  operator: "eq" | "neq" | "in" | "nin" | "contains" | "exists";
  /** Value to compare against */
  value: unknown;
}

/**
 * A policy rule that defines permissions.
 */
export interface Policy {
  /** Unique identifier for this policy */
  id: string;
  /** Human-readable name for the policy */
  name: string;
  /** Optional description */
  description?: string;
  /** The scope this policy applies at */
  scope: PolicyScope;
  /** The scope identifier (e.g., org ID) */
  scopeId: string;
  /** The effect when this policy matches */
  effect: PolicyEffect;
  /** Actions this policy applies to (wildcards supported) */
  actions: string[];
  /** Resource types this policy applies to (wildcards supported) */
  resourceTypes: string[];
  /** Optional conditions for fine-grained matching */
  conditions?: PolicyCondition[];
  /** Priority within same scope (higher = evaluated first) */
  priority?: number;
  /** Whether this policy is enabled */
  enabled?: boolean;
}

/**
 * Details about why a decision was made.
 */
export interface EvaluationReason {
  /** The policy that determined the result (if any) */
  matchedPolicyId?: string;
  /** The matched policy's effect */
  matchedEffect?: PolicyEffect;
  /** The scope of the matched policy */
  matchedScope?: PolicyScope;
  /** Number of deny policies that matched */
  denyCount: number;
  /** Number of allow policies that matched */
  allowCount: number;
  /** Whether the result came from the default effect */
  usedDefault: boolean;
  /** All matching policy IDs (for debugging) */
  allMatchedPolicyIds: string[];
}

/**
 * Result of policy evaluation.
 */
export interface EvaluationResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** The effect (allow/deny) */
  effect: PolicyEffect;
  /** Details about why this decision was made */
  reason: EvaluationReason;
}

/**
 * Configuration for the policy evaluator.
 */
export interface PolicyEvaluatorConfig {
  /**
   * Default effect when no policies match.
   * @default 'deny' (fail-closed)
   */
  defaultEffect: DefaultEffect;
}

/**
 * Scope priority order (higher index = higher priority).
 * org > team > project > user
 */
const SCOPE_PRIORITY: readonly PolicyScope[] = ["user", "project", "team", "org"] as const;

/**
 * Get the priority value for a scope.
 * Higher value = higher priority (takes precedence).
 */
function getScopePriority(scope: PolicyScope): number {
  const index = SCOPE_PRIORITY.indexOf(scope);
  return index === -1 ? -1 : index;
}

/**
 * PolicyEvaluator evaluates permission policies against an evaluation context.
 *
 * @example
 * ```ts
 * const evaluator = new PolicyEvaluator({ defaultEffect: 'deny' });
 *
 * const result = evaluator.evaluate(context, policies);
 * if (result.allowed) {
 *   // Access granted
 * } else {
 *   // Access denied: result.reason.matchedPolicyId
 * }
 * ```
 */
export class PolicyEvaluator {
  private readonly config: PolicyEvaluatorConfig;

  /**
   * Create a new PolicyEvaluator.
   *
   * @param config - Evaluator configuration
   */
  constructor(config: Partial<PolicyEvaluatorConfig> = {}) {
    this.config = {
      defaultEffect: config.defaultEffect ?? "deny",
    };
  }

  /**
   * Get the current default effect.
   */
  get defaultEffect(): DefaultEffect {
    return this.config.defaultEffect;
  }

  /**
   * Evaluate policies against a context.
   *
   * Evaluation order:
   * 1. Filter to enabled policies that match the context
   * 2. Sort by scope priority (org > team > project > user)
   * 3. Within same scope, sort by priority (higher first)
   * 4. Explicit denies take precedence over allows
   * 5. If no policies match, use the default effect
   *
   * @param context - The evaluation context
   * @param policies - The policies to evaluate
   * @returns The evaluation result
   */
  evaluate(context: EvaluationContext, policies: Policy[]): EvaluationResult {
    // Filter to enabled policies only
    const enabledPolicies = policies.filter((p) => p.enabled !== false);

    // Find all matching policies
    const matchingPolicies = enabledPolicies.filter((p) => this.policyMatches(p, context));

    // If no policies match, use the default
    if (matchingPolicies.length === 0) {
      return this.createDefaultResult();
    }

    // Sort by scope priority (highest first), then by policy priority
    const sortedPolicies = this.sortPolicies(matchingPolicies);

    // Collect all matching policy IDs for debugging
    const allMatchedPolicyIds = sortedPolicies.map((p) => p.id);

    // Count denies and allows
    const denyPolicies = sortedPolicies.filter((p) => p.effect === "deny");
    const allowPolicies = sortedPolicies.filter((p) => p.effect === "allow");

    // Explicit deny takes precedence
    if (denyPolicies.length > 0) {
      // Find the highest-priority deny
      const [topDeny] = denyPolicies;
      if (topDeny) {
        return {
          allowed: false,
          effect: "deny",
          reason: {
            matchedPolicyId: topDeny.id,
            matchedEffect: "deny",
            matchedScope: topDeny.scope,
            denyCount: denyPolicies.length,
            allowCount: allowPolicies.length,
            usedDefault: false,
            allMatchedPolicyIds,
          },
        };
      }
    }

    // No denies, check for allows
    if (allowPolicies.length > 0) {
      const [topAllow] = allowPolicies;
      if (topAllow) {
        return {
          allowed: true,
          effect: "allow",
          reason: {
            matchedPolicyId: topAllow.id,
            matchedEffect: "allow",
            matchedScope: topAllow.scope,
            denyCount: 0,
            allowCount: allowPolicies.length,
            usedDefault: false,
            allMatchedPolicyIds,
          },
        };
      }
    }

    // Should not reach here, but fall back to default
    return this.createDefaultResult();
  }

  /**
   * Check if a policy matches the given context.
   */
  private policyMatches(policy: Policy, context: EvaluationContext): boolean {
    // Check if the policy's scope is in the context's scope chain
    const scopeInChain = context.scopeChain.some(
      (entry) => entry.scope === policy.scope && entry.id === policy.scopeId,
    );
    if (!scopeInChain) {
      return false;
    }

    // Check if the action matches
    if (!this.matchesPattern(context.action, policy.actions)) {
      return false;
    }

    // Check if the resource type matches
    if (!this.matchesPattern(context.resource.type, policy.resourceTypes)) {
      return false;
    }

    // Check conditions if present
    if (policy.conditions && policy.conditions.length > 0) {
      if (!this.conditionsMatch(policy.conditions, context)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a value matches any pattern in the list.
   * Supports wildcards (*).
   */
  private matchesPattern(value: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      if (pattern === "*") return true;
      if (pattern.endsWith("*")) {
        const prefix = pattern.slice(0, -1);
        return value.startsWith(prefix);
      }
      if (pattern.startsWith("*")) {
        const suffix = pattern.slice(1);
        return value.endsWith(suffix);
      }
      return value === pattern;
    });
  }

  /**
   * Check if all conditions match the context.
   */
  private conditionsMatch(conditions: PolicyCondition[], context: EvaluationContext): boolean {
    return conditions.every((condition) => this.conditionMatches(condition, context));
  }

  /**
   * Check if a single condition matches.
   */
  private conditionMatches(condition: PolicyCondition, context: EvaluationContext): boolean {
    const fieldValue = this.getFieldValue(condition.field, context);

    switch (condition.operator) {
      case "eq":
        return fieldValue === condition.value;
      case "neq":
        return fieldValue !== condition.value;
      case "in":
        return Array.isArray(condition.value) && condition.value.includes(fieldValue);
      case "nin":
        return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
      case "contains":
        return Array.isArray(fieldValue) && fieldValue.includes(condition.value);
      case "exists":
        return condition.value ? fieldValue !== undefined : fieldValue === undefined;
      default:
        return false;
    }
  }

  /**
   * Get a nested field value from the context.
   */
  private getFieldValue(field: string, context: EvaluationContext): unknown {
    const parts = field.split(".");
    let value: unknown = context;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (typeof value === "object") {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Sort policies by scope priority (highest first), then by policy priority.
   */
  private sortPolicies(policies: Policy[]): Policy[] {
    return [...policies].sort((a, b) => {
      // First, compare by scope priority (higher scope = higher priority)
      const scopePriorityDiff = getScopePriority(b.scope) - getScopePriority(a.scope);
      if (scopePriorityDiff !== 0) {
        return scopePriorityDiff;
      }

      // Then, compare by policy priority (higher = first)
      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      return bPriority - aPriority;
    });
  }

  /**
   * Create a result using the default effect.
   */
  private createDefaultResult(): EvaluationResult {
    const allowed = this.config.defaultEffect === "allow";
    return {
      allowed,
      effect: this.config.defaultEffect,
      reason: {
        denyCount: 0,
        allowCount: 0,
        usedDefault: true,
        allMatchedPolicyIds: [],
      },
    };
  }
}

/**
 * Create a PolicyEvaluator with fail-closed default (recommended).
 */
export function createFailClosedEvaluator(): PolicyEvaluator {
  return new PolicyEvaluator({ defaultEffect: "deny" });
}

/**
 * Create a PolicyEvaluator with fail-open default.
 * Use with caution - explicitly allowing by default is less secure.
 */
export function createFailOpenEvaluator(): PolicyEvaluator {
  return new PolicyEvaluator({ defaultEffect: "allow" });
}
