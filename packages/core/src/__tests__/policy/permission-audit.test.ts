import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { createEvaluationContext } from "../../policy/evaluation-context.js";
import { evaluatePolicyWithAudit, PermissionAuditLogger } from "../../policy/permission-audit.js";
import { type Policy, PolicyEvaluator } from "../../policy/policy-evaluator.js";

describe("PermissionAuditLogger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes append-only immutable entries for each evaluation", async () => {
    const storage = new InMemoryAuditStorage();
    const logger = new PermissionAuditLogger(storage);
    await logger.init();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const firstId = await logger.logEvaluation({
      actor: "alice",
      action: "read",
      resource: "doc-1",
      result: "allow",
      tool: "policy-evaluator",
      matchedRule: { ruleId: "rule-1" },
      reason: "matched policy",
    });

    const first = await logger.get(firstId);

    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "delete",
      resource: "doc-1",
      result: "deny",
      tool: "policy-evaluator",
      reason: "explicit deny",
    });

    const firstAfter = await logger.get(firstId);
    expect(firstAfter).toEqual(first);

    const all = await logger.query({}, 10, 0);
    expect(all.total).toBe(2);
  });

  it("supports query filters by actor/action/result/date range", async () => {
    const storage = new InMemoryAuditStorage();
    const logger = new PermissionAuditLogger(storage);
    await logger.init();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "read",
      resource: "doc-1",
      result: "allow",
      tool: "editor",
      matchedRule: { ruleId: "allow-read" },
    });

    vi.setSystemTime(new Date("2026-01-05T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "read",
      resource: "doc-2",
      result: "deny",
      tool: "editor",
      matchedRule: { ruleId: "deny-read" },
    });

    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "bob",
      action: "write",
      resource: "doc-3",
      result: "allow",
      tool: "cli",
      matchedRule: { ruleId: "allow-write" },
    });

    const filtered = await logger.query({
      actor: "alice",
      action: "read",
      result: "deny",
      startTime: new Date("2026-01-02T00:00:00.000Z"),
      endTime: new Date("2026-01-31T00:00:00.000Z"),
    });

    expect(filtered.total).toBe(1);
    expect(filtered.entries[0]?.actor).toBe("alice");
    expect(filtered.entries[0]?.action).toBe("read");
    expect(filtered.entries[0]?.result).toBe("deny");
  });

  it("enforces retention semantics to minimum 24 months", () => {
    const storage = new InMemoryAuditStorage();
    const now = new Date("2026-03-01T00:00:00.000Z");
    vi.setSystemTime(now);

    const logger = new PermissionAuditLogger(storage, { retentionMonths: 3 });
    const cutoff = logger.getRetentionCutoff();

    const months =
      now.getUTCFullYear() * 12 +
      now.getUTCMonth() -
      (cutoff.getUTCFullYear() * 12 + cutoff.getUTCMonth());

    expect(months).toBeGreaterThanOrEqual(24);
  });
});

describe("evaluatePolicyWithAudit", () => {
  it("emits an audit entry on match and on no-match", async () => {
    vi.useFakeTimers();
    const storage = new InMemoryAuditStorage();
    const logger = new PermissionAuditLogger(storage);
    await logger.init();

    const evaluator = new PolicyEvaluator({ defaultEffect: "deny" });
    const context = createEvaluationContext(
      { id: "user-1", type: "user" },
      "read",
      { type: "document", id: "doc-1" },
      [{ scope: "org", id: "org-1" }],
    );

    const allowPolicies: Policy[] = [
      {
        id: "allow-read",
        name: "Allow read",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["read"],
        resourceTypes: ["document"],
      },
    ];

    await evaluatePolicyWithAudit(evaluator, context, allowPolicies, logger, {
      tool: "policy-engine",
    });

    await evaluatePolicyWithAudit(evaluator, context, [], logger, {
      tool: "policy-engine",
    });

    const entries = await logger.query({}, 10, 0);
    expect(entries.total).toBe(2);

    const allowEntry = entries.entries.find((entry) => entry.result === "allow");
    const denyEntry = entries.entries.find((entry) => entry.result === "deny");

    expect(allowEntry?.matchedRule?.ruleId).toBe("allow-read");
    expect(denyEntry?.matchedRule).toBeUndefined();
    expect(denyEntry?.reason).toBe("no matching policy");

    vi.useRealTimers();
  });
});
