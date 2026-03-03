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
 * 3. **Inheritance/Override** (PERM-010)
 *    - Policies are inherited down the scope chain by default
 *    - `inherit: false` restricts a policy to its own scope context only
 *    - `override: true` at a lower scope cuts off inherited higher-scope
 *      policies for the current evaluation context
 *
 * 4. **Default Behavior**: Configurable per organization
 *    - fail-closed (deny): Default for new organizations
 *    - fail-open (allow): Must be explicitly configured
 *
 * Evaluation is consistent and deterministic - the same context and
 * policies will always produce the same result.
 */

import { conditionsMatch } from "./condition-evaluator.js";
import type { EvaluationContext, PolicyScope } from "./evaluation-context.js";

export type PolicyEffect = "allow" | "deny";
export type DefaultEffect = "deny" | "allow";

export interface PolicyCondition {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "in"
    | "nin"
    | "contains"
    | "exists"
    | "regex"
    | "gt"
    | "gte"
    | "lt"
    | "lte";
  value: unknown;
}

export type PolicyRiskLevel = "low" | "medium" | "high";

export interface Policy {
  id: string;
  name: string;
  description?: string;
  scope: PolicyScope;
  scopeId: string;
  effect: PolicyEffect;
  actions: string[];
  resourceTypes: string[];
  conditions?: PolicyCondition[];
  priority?: number;
  enabled?: boolean;
  /**
   * Whether this policy should be inherited by lower scopes.
   * Defaults to true.
   */
  inherit?: boolean;
  /**
   * Whether this policy explicitly overrides inherited policies from
   * higher scopes for the current evaluation context.
   * Defaults to false.
   */
  override?: boolean;
  /** Marks an allowed action as requiring human approval before execution. */
  requiresApproval?: boolean;
  /** High-risk actions are treated as approval-gated by approval integrations. */
  riskLevel?: PolicyRiskLevel;
  /** Optional approval gate TTL override in milliseconds. */
  approvalTtlMs?: number;
}

export interface EvaluationReason {
  matchedPolicyId?: string;
  matchedEffect?: PolicyEffect;
  matchedScope?: PolicyScope;
  denyCount: number;
  allowCount: number;
  usedDefault: boolean;
  allMatchedPolicyIds: string[];
}

export interface EvaluationResult {
  allowed: boolean;
  effect: PolicyEffect;
  reason: EvaluationReason;
}

export interface PolicyEvaluatorConfig {
  defaultEffect: DefaultEffect;
}

const SCOPE_PRIORITY: readonly PolicyScope[] = ["user", "project", "team", "org"] as const;

function getScopePriority(scope: PolicyScope): number {
  const index = SCOPE_PRIORITY.indexOf(scope);
  return index === -1 ? -1 : index;
}

/**
 * Resolve the effective matching policy set after applying inheritance
 * and explicit override behavior.
 */
export function resolveInheritedPolicies(
  context: EvaluationContext,
  matchingPolicies: Policy[],
): Policy[] {
  const activeScope = context.scopeChain[0];

  const inheritablePolicies = matchingPolicies.filter((policy) => {
    if (policy.inherit !== false) {
      return true;
    }

    if (!activeScope) {
      return false;
    }

    return policy.scope === activeScope.scope && policy.scopeId === activeScope.id;
  });

  const overridePolicies = inheritablePolicies.filter((policy) => policy.override === true);
  if (overridePolicies.length === 0) {
    return inheritablePolicies;
  }

  const strongestOverridePriority = Math.min(
    ...overridePolicies.map((policy) => getScopePriority(policy.scope)),
  );

  return inheritablePolicies.filter(
    (policy) => getScopePriority(policy.scope) <= strongestOverridePriority,
  );
}

export class PolicyEvaluator {
  private readonly config: PolicyEvaluatorConfig;

  constructor(config: Partial<PolicyEvaluatorConfig> = {}) {
    this.config = {
      defaultEffect: config.defaultEffect ?? "deny",
    };
  }

  get defaultEffect(): DefaultEffect {
    return this.config.defaultEffect;
  }

  evaluate(context: EvaluationContext, policies: Policy[]): EvaluationResult {
    const enabledPolicies = policies.filter((p) => p.enabled !== false);
    const matchingPolicies = enabledPolicies.filter((p) => this.policyMatches(p, context));
    const resolvedPolicies = resolveInheritedPolicies(context, matchingPolicies);

    if (resolvedPolicies.length === 0) {
      return this.createDefaultResult();
    }

    const sortedPolicies = this.sortPolicies(resolvedPolicies);
    const allMatchedPolicyIds = sortedPolicies.map((p) => p.id);
    const denyPolicies = sortedPolicies.filter((p) => p.effect === "deny");
    const allowPolicies = sortedPolicies.filter((p) => p.effect === "allow");

    if (denyPolicies.length > 0) {
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

    return this.createDefaultResult();
  }

  private policyMatches(policy: Policy, context: EvaluationContext): boolean {
    const scopeInChain = context.scopeChain.some(
      (entry) => entry.scope === policy.scope && entry.id === policy.scopeId,
    );
    if (!scopeInChain) {
      return false;
    }

    if (!this.matchesPattern(context.action, policy.actions)) {
      return false;
    }

    if (!this.matchesPattern(context.resource.type, policy.resourceTypes)) {
      return false;
    }

    if (policy.conditions && policy.conditions.length > 0) {
      if (!conditionsMatch(policy.conditions, context)) {
        return false;
      }
    }

    return true;
  }

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

  private sortPolicies(policies: Policy[]): Policy[] {
    return [...policies].sort((a, b) => {
      const scopePriorityDiff = getScopePriority(b.scope) - getScopePriority(a.scope);
      if (scopePriorityDiff !== 0) {
        return scopePriorityDiff;
      }

      const aPriority = a.priority ?? 0;
      const bPriority = b.priority ?? 0;
      if (bPriority !== aPriority) {
        return bPriority - aPriority;
      }

      return a.id.localeCompare(b.id);
    });
  }

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

export function createFailClosedEvaluator(): PolicyEvaluator {
  return new PolicyEvaluator({ defaultEffect: "deny" });
}

export function createFailOpenEvaluator(): PolicyEvaluator {
  return new PolicyEvaluator({ defaultEffect: "allow" });
}
