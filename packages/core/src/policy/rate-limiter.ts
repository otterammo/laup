import type { AuditStorage } from "../audit-storage.js";
import type { AuthContext } from "../auth/auth-types.js";
import type { EvaluationContext } from "./evaluation-context.js";

export type RateLimitDimension = "actor" | "tool" | "project";

export interface RateLimitRule {
  id: string;
  dimensions: RateLimitDimension[];
  limit: number;
  windowMs: number;
  actionPatterns?: string[];
}

export interface RateLimiterConfig {
  rules: RateLimitRule[];
  auditStorage?: AuditStorage;
  now?: () => Date;
}

export interface RateLimitContext {
  actor: string;
  action: string;
  tool?: string;
  project?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface RateLimitCounter {
  count: number;
  windowStartedAtMs: number;
}

export interface RateLimitCheck {
  ruleId: string;
  key: string;
  count: number;
  limit: number;
  remaining: number;
  windowStartedAt: string;
  windowEndsAt: string;
  exceeded: boolean;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason: "within_limits" | "limit_exceeded";
  checks: RateLimitCheck[];
  exceededBy?: RateLimitCheck;
}

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED";

  constructor(
    message: string,
    public readonly decision: RateLimitDecision,
  ) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}

/**
 * In-memory deterministic rate limiter for policy/action enforcement.
 *
 * Rule evaluation is deterministic: sorted by id, then by dimension signature.
 */
export class RateLimiter {
  private readonly auditStorage: AuditStorage | undefined;
  private readonly now: () => Date;
  private readonly rules: RateLimitRule[];
  private readonly counters = new Map<string, RateLimitCounter>();

  constructor(config: RateLimiterConfig) {
    this.auditStorage = config.auditStorage;
    this.now = config.now ?? (() => new Date());
    this.rules = [...config.rules]
      .map((rule) => normalizeRule(rule))
      .sort((a, b) => a.id.localeCompare(b.id) || signature(a).localeCompare(signature(b)));
  }

  getRules(): RateLimitRule[] {
    return this.rules.map((rule) => {
      const next: RateLimitRule = {
        id: rule.id,
        dimensions: [...rule.dimensions],
        limit: rule.limit,
        windowMs: rule.windowMs,
      };

      if (rule.actionPatterns) {
        next.actionPatterns = [...rule.actionPatterns];
      }

      return next;
    });
  }

  /**
   * Deterministically checks and consumes one unit from each matching rule bucket.
   */
  async consume(context: RateLimitContext): Promise<RateLimitDecision> {
    const nowMs = this.now().getTime();
    const checks = this.rules
      .filter((rule) => matchesAction(rule, context.action))
      .map((rule) => this.consumeRule(rule, context, nowMs));

    const exceededBy = checks.find((check) => check.exceeded);

    const decision: RateLimitDecision = exceededBy
      ? {
          allowed: false,
          reason: "limit_exceeded",
          checks,
          exceededBy,
        }
      : {
          allowed: true,
          reason: "within_limits",
          checks,
        };

    await this.auditDecision(context, decision);
    return decision;
  }

  /**
   * Resets all counters. Primarily useful in tests.
   */
  reset(): void {
    this.counters.clear();
  }

  private consumeRule(
    rule: RateLimitRule,
    context: RateLimitContext,
    nowMs: number,
  ): RateLimitCheck {
    const key = counterKey(rule, context);
    const current = this.counters.get(key);

    let counter: RateLimitCounter;
    if (!current || isWindowExpired(current, rule.windowMs, nowMs)) {
      counter = {
        count: 0,
        windowStartedAtMs: nowMs,
      };
    } else {
      counter = current;
    }

    counter.count += 1;
    this.counters.set(key, counter);

    const remaining = Math.max(rule.limit - counter.count, 0);

    return {
      ruleId: rule.id,
      key,
      count: counter.count,
      limit: rule.limit,
      remaining,
      windowStartedAt: new Date(counter.windowStartedAtMs).toISOString(),
      windowEndsAt: new Date(counter.windowStartedAtMs + rule.windowMs).toISOString(),
      exceeded: counter.count > rule.limit,
    };
  }

  private async auditDecision(
    context: RateLimitContext,
    decision: RateLimitDecision,
  ): Promise<void> {
    if (!this.auditStorage) {
      return;
    }

    await this.auditStorage.append({
      category: "security",
      action: decision.allowed ? "rate-limit.enforce.allow" : "rate-limit.enforce.deny",
      actor: context.actor,
      ...(context.project ? { targetId: context.project } : {}),
      targetType: "project",
      severity: decision.allowed ? "info" : "warning",
      ...(context.correlationId ? { correlationId: context.correlationId } : {}),
      ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      reason: decision.allowed ? "rate limit check passed" : "rate limit exceeded",
      metadata: {
        action: context.action,
        ...(context.tool ? { tool: context.tool } : {}),
        ...(context.project ? { project: context.project } : {}),
        decision: decision.reason,
        checks: decision.checks,
        ...(decision.exceededBy ? { exceededBy: decision.exceededBy } : {}),
      },
    });
  }
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  return new RateLimiter(config);
}

/**
 * Deterministic helper for action execution paths.
 * Throws RateLimitExceededError when the request should be blocked.
 */
export async function enforceRateLimit(
  rateLimiter: RateLimiter,
  context: RateLimitContext,
): Promise<RateLimitDecision> {
  const decision = await rateLimiter.consume(context);
  if (!decision.allowed) {
    const exceeded = decision.exceededBy;
    const message = exceeded
      ? `Rate limit exceeded for rule ${exceeded.ruleId} (${exceeded.count}/${exceeded.limit})`
      : "Rate limit exceeded";

    throw new RateLimitExceededError(message, decision);
  }

  return decision;
}

/**
 * Helper to bridge auth/policy context identifiers into a rate-limit context.
 */
export function createRateLimitContext(params: {
  evaluation: EvaluationContext;
  auth?: AuthContext;
  tool?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}): RateLimitContext {
  const projectFromScope = params.evaluation.scopeChain.find(
    (entry) => entry.scope === "project",
  )?.id;

  const context: RateLimitContext = {
    actor: params.auth?.identity.id ?? params.evaluation.actor.id,
    action: params.evaluation.action,
  };

  if (params.tool) {
    context.tool = params.tool;
  }

  if (projectFromScope) {
    context.project = projectFromScope;
  }

  if (params.correlationId) {
    context.correlationId = params.correlationId;
  }

  if (params.ipAddress) {
    context.ipAddress = params.ipAddress;
  }

  if (params.userAgent) {
    context.userAgent = params.userAgent;
  }

  return context;
}

function normalizeRule(rule: RateLimitRule): RateLimitRule {
  const dimensions = [...new Set(rule.dimensions)].sort() as RateLimitDimension[];

  const normalized: RateLimitRule = {
    id: rule.id,
    dimensions,
    limit: Math.max(Math.floor(rule.limit), 1),
    windowMs: Math.max(Math.floor(rule.windowMs), 1),
  };

  if (rule.actionPatterns) {
    normalized.actionPatterns = [...rule.actionPatterns];
  }

  return normalized;
}

function signature(rule: RateLimitRule): string {
  return `${rule.dimensions.join("+")}|${rule.windowMs}|${rule.limit}`;
}

function matchesAction(rule: RateLimitRule, action: string): boolean {
  if (!rule.actionPatterns || rule.actionPatterns.length === 0) {
    return true;
  }

  return rule.actionPatterns.some((pattern) => matchesPattern(action, pattern));
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }

  if (pattern.startsWith("*")) {
    return value.endsWith(pattern.slice(1));
  }

  return value === pattern;
}

function counterKey(rule: RateLimitRule, context: RateLimitContext): string {
  const dimensions = rule.dimensions.map((dimension) => {
    if (dimension === "actor") {
      return `actor:${context.actor}`;
    }

    if (dimension === "tool") {
      return `tool:${context.tool ?? "<none>"}`;
    }

    return `project:${context.project ?? "<none>"}`;
  });

  return `${rule.id}|${dimensions.join("|")}`;
}

function isWindowExpired(counter: RateLimitCounter, windowMs: number, nowMs: number): boolean {
  return nowMs - counter.windowStartedAtMs >= windowMs;
}
