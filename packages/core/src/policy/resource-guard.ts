import type { AuditStorage } from "../audit-storage.js";
import { matchesGlob } from "./policy-matcher.js";

export type GuardTargetType = "url" | "api" | "file";

export type GuardRuleEffect = "allow" | "deny";

export type GuardPatternType = "exact" | "prefix" | "glob";

export interface ResourceGuardRule {
  id: string;
  effect: GuardRuleEffect;
  targetType: GuardTargetType;
  pattern: string;
  patternType?: GuardPatternType;
}

export interface ResourceGuardConfig {
  rules: ResourceGuardRule[];
  auditStorage?: AuditStorage;
}

export interface ResourceGuardCheck {
  ruleId: string;
  effect: GuardRuleEffect;
  targetType: GuardTargetType;
  pattern: string;
  patternType: GuardPatternType;
  matched: boolean;
}

export interface ResourceGuardDecision {
  allowed: boolean;
  reason: "allowed" | "explicit_deny" | "no_allow_rule";
  targetType: GuardTargetType;
  target: string;
  checks: ResourceGuardCheck[];
  matchedRule?: Omit<ResourceGuardCheck, "matched">;
}

export class ResourceAccessBlockedError extends Error {
  readonly code = "RESOURCE_ACCESS_BLOCKED";

  constructor(
    message: string,
    public readonly decision: ResourceGuardDecision,
  ) {
    super(message);
    this.name = "ResourceAccessBlockedError";
  }
}

interface NormalizedRule extends Omit<ResourceGuardRule, "patternType"> {
  patternType: GuardPatternType;
}

/**
 * Deterministic allow/deny guard for URL/API/file targets.
 *
 * Evaluation semantics:
 * - Only rules matching the requested target type are considered
 * - Deny precedence is explicit: any matched deny rule blocks access
 * - If allow rules exist for the target type, at least one must match
 * - If no allow rule exists for the target type, default is allow unless denied
 */
export class ResourceGuard {
  private readonly rules: NormalizedRule[];
  private readonly auditStorage: AuditStorage | undefined;

  constructor(config: ResourceGuardConfig) {
    this.auditStorage = config.auditStorage;
    this.rules = [...config.rules].map(normalizeRule).sort(compareRulesDeterministically);
  }

  getRules(): ResourceGuardRule[] {
    return this.rules.map((rule) => ({
      id: rule.id,
      effect: rule.effect,
      targetType: rule.targetType,
      pattern: rule.pattern,
      patternType: rule.patternType,
    }));
  }

  async evaluate(input: {
    actor: string;
    targetType: GuardTargetType;
    target: string;
    correlationId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<ResourceGuardDecision> {
    const relevantRules = this.rules.filter((rule) => rule.targetType === input.targetType);
    const checks = relevantRules.map((rule) => {
      const matched = matchesPattern(rule.patternType, rule.pattern, input.target);
      return {
        ruleId: rule.id,
        effect: rule.effect,
        targetType: rule.targetType,
        pattern: rule.pattern,
        patternType: rule.patternType,
        matched,
      } satisfies ResourceGuardCheck;
    });

    const matchedDeny = checks.find((check) => check.matched && check.effect === "deny");
    const matchedAllow = checks.find((check) => check.matched && check.effect === "allow");
    const hasAllowRules = checks.some((check) => check.effect === "allow");

    let decision: ResourceGuardDecision;
    if (matchedDeny) {
      decision = {
        allowed: false,
        reason: "explicit_deny",
        targetType: input.targetType,
        target: input.target,
        checks,
        matchedRule: toMatchedRule(matchedDeny),
      };
    } else if (matchedAllow) {
      decision = {
        allowed: true,
        reason: "allowed",
        targetType: input.targetType,
        target: input.target,
        checks,
        matchedRule: toMatchedRule(matchedAllow),
      };
    } else if (hasAllowRules) {
      decision = {
        allowed: false,
        reason: "no_allow_rule",
        targetType: input.targetType,
        target: input.target,
        checks,
      };
    } else {
      decision = {
        allowed: true,
        reason: "allowed",
        targetType: input.targetType,
        target: input.target,
        checks,
      };
    }

    await this.auditDecision(input, decision);
    return decision;
  }

  private async auditDecision(
    input: {
      actor: string;
      targetType: GuardTargetType;
      target: string;
      correlationId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
    decision: ResourceGuardDecision,
  ): Promise<void> {
    if (!this.auditStorage) {
      return;
    }

    await this.auditStorage.append({
      category: "security",
      action: decision.allowed ? "resource-guard.enforce.allow" : "resource-guard.enforce.deny",
      actor: input.actor,
      targetId: input.target,
      targetType: input.targetType,
      severity: decision.allowed ? "info" : "warning",
      reason: decision.allowed ? "resource access allowed" : "resource access blocked",
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      metadata: {
        decision: decision.reason,
        matchedRule: decision.matchedRule,
        checks: decision.checks,
      },
    });
  }
}

export function createResourceGuard(config: ResourceGuardConfig): ResourceGuard {
  return new ResourceGuard(config);
}

/**
 * Deterministic helper for action execution paths.
 * Throws ResourceAccessBlockedError when the request should be blocked.
 */
export async function enforceResourceAccess(
  guard: ResourceGuard,
  input: {
    actor: string;
    targetType: GuardTargetType;
    target: string;
    correlationId?: string;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<ResourceGuardDecision> {
  const decision = await guard.evaluate(input);
  if (!decision.allowed) {
    const message = decision.matchedRule
      ? `Resource blocked by ${decision.matchedRule.effect} rule ${decision.matchedRule.ruleId}`
      : `Resource blocked: no allow rule matched for ${input.targetType}`;

    throw new ResourceAccessBlockedError(message, decision);
  }

  return decision;
}

function normalizeRule(rule: ResourceGuardRule): NormalizedRule {
  return {
    id: rule.id,
    effect: rule.effect,
    targetType: rule.targetType,
    pattern: rule.pattern,
    patternType: rule.patternType ?? inferPatternType(rule.pattern),
  };
}

function inferPatternType(pattern: string): GuardPatternType {
  if (pattern.includes("*")) {
    return "glob";
  }

  return "exact";
}

function compareRulesDeterministically(a: NormalizedRule, b: NormalizedRule): number {
  return (
    a.targetType.localeCompare(b.targetType) ||
    a.id.localeCompare(b.id) ||
    a.effect.localeCompare(b.effect) ||
    a.patternType.localeCompare(b.patternType) ||
    a.pattern.localeCompare(b.pattern)
  );
}

function matchesPattern(patternType: GuardPatternType, pattern: string, value: string): boolean {
  if (patternType === "exact") {
    return value === pattern;
  }

  if (patternType === "prefix") {
    return value.startsWith(pattern);
  }

  return matchesGlob(pattern, value);
}

function toMatchedRule(check: ResourceGuardCheck): Omit<ResourceGuardCheck, "matched"> {
  return {
    ruleId: check.ruleId,
    effect: check.effect,
    targetType: check.targetType,
    pattern: check.pattern,
    patternType: check.patternType,
  };
}
