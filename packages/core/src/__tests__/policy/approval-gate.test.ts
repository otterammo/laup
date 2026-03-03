import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { ApprovalGateService, evaluatePolicyWithApprovalGate } from "../../policy/approval-gate.js";
import { createEvaluationContext } from "../../policy/evaluation-context.js";
import { type Policy, PolicyEvaluator } from "../../policy/policy-evaluator.js";

describe("ApprovalGateService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates pending request, supports approve/deny, and records audit events", async () => {
    const storage = new InMemoryAuditStorage();
    const service = new ApprovalGateService({ auditStorage: storage, defaultTtlMs: 60_000 });

    const created = await service.createRequest({
      actor: "alice",
      action: "tool.exec",
      resource: "server:prod",
      resourceType: "tool-call",
      policyId: "risk-1",
      reason: "high-risk",
      correlationId: "corr-1",
    });

    expect(created.status).toBe("pending");

    const approved = await service.approve(created.id, {
      actor: "approver-1",
      reason: "looks safe",
      correlationId: "corr-1",
    });
    expect(approved?.status).toBe("approved");

    const denied = await service.deny(created.id, {
      actor: "approver-2",
      reason: "too late",
    });
    // Cannot deny after approval, state stays approved
    expect(denied?.status).toBe("approved");

    const audit = await storage.query({}, 20, 0);
    const actions = audit.entries.map((entry) => entry.action);
    expect(actions).toContain("approval.request");
    expect(actions).toContain("approval.approve");
  });

  it("expires pending requests and emits expiry audit", async () => {
    const storage = new InMemoryAuditStorage();
    const service = new ApprovalGateService({ auditStorage: storage, defaultTtlMs: 1_000 });

    await service.createRequest({
      actor: "alice",
      action: "tool.exec",
      resource: "server:prod",
      resourceType: "tool-call",
      policyId: "risk-2",
      reason: "requires-approval",
    });

    vi.advanceTimersByTime(1_500);
    const decision = await service.evaluate({
      actor: "alice",
      action: "tool.exec",
      resource: "server:prod",
      resourceType: "tool-call",
      policyId: "risk-2",
      reason: "requires-approval",
    });

    expect(decision.status).toBe("expired");

    const audit = await storage.query({}, 20, 0);
    expect(audit.entries.some((entry) => entry.action === "approval.expire")).toBe(true);
  });
});

describe("evaluatePolicyWithApprovalGate", () => {
  const context = createEvaluationContext(
    { id: "user-1", type: "user" },
    "execute",
    { type: "tool-call", id: "shell" },
    [{ scope: "org", id: "org-1" }],
  );

  const evaluate = async (policies: Policy[], gate: ApprovalGateService) => {
    const evaluator = new PolicyEvaluator();
    const baseResult = evaluator.evaluate(context, policies);

    return evaluatePolicyWithApprovalGate({
      context,
      policies,
      baseResult,
      gateService: gate,
      correlationId: "corr-e2e",
    });
  };

  it("returns gated until approved, then allows", async () => {
    const gate = new ApprovalGateService();

    const policies: Policy[] = [
      {
        id: "allow-high-risk",
        name: "Allow high-risk exec",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["execute"],
        resourceTypes: ["tool-call"],
        requiresApproval: true,
      },
    ];

    const gated = await evaluate(policies, gate);
    expect(gated.status).toBe("gated");
    expect(gated.request?.status).toBe("pending");

    await gate.approve(gated.request?.id ?? "", { actor: "human-approver" });

    const allowed = await evaluate(policies, gate);
    expect(allowed.status).toBe("allow");
    expect(allowed.baseResult.allowed).toBe(true);
  });

  it("preserves deny precedence over allow/approval-gate rules", async () => {
    const gate = new ApprovalGateService();

    const policies: Policy[] = [
      {
        id: "allow-high-risk",
        name: "Allow high-risk exec",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["execute"],
        resourceTypes: ["tool-call"],
        requiresApproval: true,
      },
      {
        id: "deny-org",
        name: "Deny all execute",
        scope: "org",
        scopeId: "org-1",
        effect: "deny",
        actions: ["execute"],
        resourceTypes: ["tool-call"],
      },
    ];

    const result = await evaluate(policies, gate);
    expect(result.status).toBe("deny");
    expect(result.request).toBeUndefined();
  });

  it("returns deny when request is denied", async () => {
    const gate = new ApprovalGateService();

    const policies: Policy[] = [
      {
        id: "allow-high-risk",
        name: "Allow high-risk exec",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["execute"],
        resourceTypes: ["tool-call"],
        riskLevel: "high",
      },
    ];

    const first = await evaluate(policies, gate);
    expect(first.status).toBe("gated");
    await gate.deny(first.request?.id ?? "", { actor: "human-approver", reason: "no" });

    const second = await evaluate(policies, gate);
    expect(second.status).toBe("deny");
    expect(second.baseResult.allowed).toBe(false);
  });
});
