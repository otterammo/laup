import type { AuditStorage } from "../audit-storage.js";
import type { EvaluationContext } from "./evaluation-context.js";
import type { EvaluationResult, Policy } from "./policy-evaluator.js";

export type ApprovalDecisionStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalEnforcementStatus = "allow" | "deny" | "gated";

export interface ApprovalGateRequest {
  id: string;
  actor: string;
  action: string;
  resource: string;
  resourceType: string;
  policyId: string;
  reason: string;
  status: ApprovalDecisionStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

export interface ApprovalGateCreateInput {
  actor: string;
  action: string;
  resource: string;
  resourceType: string;
  policyId: string;
  reason: string;
  ttlMs?: number;
  correlationId?: string;
  context?: Record<string, unknown>;
}

export interface ApprovalGateDecisionInput {
  actor: string;
  reason?: string;
  correlationId?: string;
}

export interface ApprovalGateEvaluateInput {
  actor: string;
  action: string;
  resource: string;
  resourceType: string;
  policyId: string;
  reason: string;
  ttlMs?: number;
  correlationId?: string;
  context?: Record<string, unknown>;
}

export interface ApprovalGateEvaluateResult {
  status: ApprovalDecisionStatus;
  request: ApprovalGateRequest;
}

export interface ApprovalPolicyEvaluationResult {
  status: ApprovalEnforcementStatus;
  baseResult: EvaluationResult;
  request?: ApprovalGateRequest;
}

export interface ApprovalGateConfig {
  defaultTtlMs?: number;
  now?: () => Date;
  auditStorage?: AuditStorage;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;

export class ApprovalGateService {
  private readonly requests = new Map<string, ApprovalGateRequest>();
  private readonly indexByFingerprint = new Map<string, string>();
  private readonly now: () => Date;
  private readonly defaultTtlMs: number;

  constructor(private readonly config: ApprovalGateConfig = {}) {
    this.now = config.now ?? (() => new Date());
    this.defaultTtlMs = Math.max(config.defaultTtlMs ?? DEFAULT_TTL_MS, 1);
  }

  async createRequest(input: ApprovalGateCreateInput): Promise<ApprovalGateRequest> {
    const existing = this.findLatestByFingerprint(this.fingerprint(input));
    if (existing && existing.status === "pending") {
      return existing;
    }

    const createdAt = this.now();
    const ttlMs = Math.max(input.ttlMs ?? this.defaultTtlMs, 1);
    const request: ApprovalGateRequest = {
      id: createId("apr"),
      actor: input.actor,
      action: input.action,
      resource: input.resource,
      resourceType: input.resourceType,
      policyId: input.policyId,
      reason: input.reason,
      status: "pending",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.context ? { context: input.context } : {}),
    };

    this.requests.set(request.id, request);
    this.indexByFingerprint.set(this.fingerprint(input), request.id);

    await this.audit("approval.request", "warning", input.actor, request, input.correlationId);
    return request;
  }

  async approve(
    requestId: string,
    input: ApprovalGateDecisionInput,
  ): Promise<ApprovalGateRequest | null> {
    const request = this.requests.get(requestId);
    if (!request) {
      return null;
    }

    const current = await this.expireIfNeeded(request);
    if (current.status !== "pending") {
      return current;
    }

    const approved: ApprovalGateRequest = {
      ...current,
      status: "approved",
      decidedAt: this.now().toISOString(),
      decidedBy: input.actor,
      ...(input.reason ? { decisionReason: input.reason } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };
    this.requests.set(requestId, approved);

    await this.audit("approval.approve", "info", input.actor, approved, input.correlationId);
    return approved;
  }

  async deny(
    requestId: string,
    input: ApprovalGateDecisionInput,
  ): Promise<ApprovalGateRequest | null> {
    const request = this.requests.get(requestId);
    if (!request) {
      return null;
    }

    const current = await this.expireIfNeeded(request);
    if (current.status !== "pending") {
      return current;
    }

    const denied: ApprovalGateRequest = {
      ...current,
      status: "denied",
      decidedAt: this.now().toISOString(),
      decidedBy: input.actor,
      ...(input.reason ? { decisionReason: input.reason } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };
    this.requests.set(requestId, denied);

    await this.audit("approval.deny", "warning", input.actor, denied, input.correlationId);
    return denied;
  }

  async evaluate(input: ApprovalGateEvaluateInput): Promise<ApprovalGateEvaluateResult> {
    const existing = this.findLatestByFingerprint(this.fingerprint(input));
    if (!existing) {
      const request = await this.createRequest(input);
      return { status: request.status, request };
    }

    const request = await this.expireIfNeeded(existing);
    return { status: request.status, request };
  }

  async get(requestId: string): Promise<ApprovalGateRequest | null> {
    const request = this.requests.get(requestId);
    if (!request) {
      return null;
    }

    return this.expireIfNeeded(request);
  }

  async logEnforcement(
    action:
      | "approval.enforce.allow"
      | "approval.enforce.gated"
      | "approval.enforce.deny"
      | "approval.enforce.expired",
    actor: string,
    request: ApprovalGateRequest,
    correlationId?: string,
  ): Promise<void> {
    await this.audit(
      action,
      action === "approval.enforce.allow" ? "info" : "warning",
      actor,
      request,
      correlationId,
    );
  }

  private findLatestByFingerprint(fingerprint: string): ApprovalGateRequest | null {
    const requestId = this.indexByFingerprint.get(fingerprint);
    if (!requestId) {
      return null;
    }

    return this.requests.get(requestId) ?? null;
  }

  private async expireIfNeeded(request: ApprovalGateRequest): Promise<ApprovalGateRequest> {
    if (request.status !== "pending") {
      return request;
    }

    if (this.now().getTime() <= Date.parse(request.expiresAt)) {
      return request;
    }

    const expired: ApprovalGateRequest = {
      ...request,
      status: "expired",
      decidedAt: this.now().toISOString(),
    };

    this.requests.set(request.id, expired);
    await this.audit("approval.expire", "warning", "system", expired, request.correlationId);
    return expired;
  }

  private fingerprint(input: {
    actor: string;
    action: string;
    resource: string;
    resourceType: string;
    policyId: string;
  }): string {
    return `${input.actor}:${input.action}:${input.resourceType}:${input.resource}:${input.policyId}`;
  }

  private async audit(
    action: string,
    severity: "info" | "warning" | "critical",
    actor: string,
    request: ApprovalGateRequest,
    correlationId?: string,
  ): Promise<void> {
    if (!this.config.auditStorage) {
      return;
    }

    await this.config.auditStorage.append({
      category: "access",
      action,
      actor,
      targetId: request.id,
      targetType: "approval-request",
      severity,
      ...(correlationId ? { correlationId } : {}),
      metadata: {
        requestStatus: request.status,
        policyId: request.policyId,
        permissionAction: request.action,
        resource: request.resource,
        resourceType: request.resourceType,
        reason: request.reason,
        expiresAt: request.expiresAt,
        decidedBy: request.decidedBy,
      },
    });
  }
}

export async function evaluatePolicyWithApprovalGate(params: {
  context: EvaluationContext;
  policies: Policy[];
  baseResult: EvaluationResult;
  gateService: ApprovalGateService;
  correlationId?: string;
  actorOverride?: string;
}): Promise<ApprovalPolicyEvaluationResult> {
  const { context, policies, baseResult, gateService, correlationId, actorOverride } = params;

  if (!baseResult.allowed) {
    return { status: "deny", baseResult };
  }

  const matchedPolicyIds = new Set(baseResult.reason.allMatchedPolicyIds);
  const matchedAllowPolicies = policies.filter(
    (policy) => policy.effect === "allow" && matchedPolicyIds.has(policy.id),
  );

  const gatedPolicy = matchedAllowPolicies.find(
    (policy) => policy.requiresApproval === true || policy.riskLevel === "high",
  );

  if (!gatedPolicy) {
    return { status: "allow", baseResult };
  }

  const gateDecision = await gateService.evaluate({
    actor: context.actor.id,
    action: context.action,
    resource: context.resource.id ?? context.resource.type,
    resourceType: context.resource.type,
    policyId: gatedPolicy.id,
    reason: gatedPolicy.requiresApproval ? "requires-approval" : "high-risk",
    ...(typeof gatedPolicy.approvalTtlMs === "number" ? { ttlMs: gatedPolicy.approvalTtlMs } : {}),
    ...(correlationId ? { correlationId } : {}),
    context: {
      matchedPolicyId: baseResult.reason.matchedPolicyId,
      matchedScope: baseResult.reason.matchedScope,
    },
  });

  const actor = actorOverride ?? context.actor.id;
  if (gateDecision.status === "approved") {
    await gateService.logEnforcement(
      "approval.enforce.allow",
      actor,
      gateDecision.request,
      correlationId,
    );
    return { status: "allow", baseResult, request: gateDecision.request };
  }

  const enforcementAction =
    gateDecision.status === "pending"
      ? "approval.enforce.gated"
      : gateDecision.status === "denied"
        ? "approval.enforce.deny"
        : "approval.enforce.expired";

  await gateService.logEnforcement(enforcementAction, actor, gateDecision.request, correlationId);

  return {
    status: gateDecision.status === "pending" ? "gated" : "deny",
    baseResult: {
      ...baseResult,
      allowed: false,
      effect: "deny",
    },
    request: gateDecision.request,
  };
}

export function createApprovalGateService(config: ApprovalGateConfig = {}): ApprovalGateService {
  return new ApprovalGateService(config);
}

function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}_${random}`;
}
