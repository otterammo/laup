import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { PolicyNotificationAggregator } from "../../policy/policy-notifications.js";

describe("PolicyNotificationAggregator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps kill-switch and approval audit events to notification payloads", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    vi.setSystemTime(new Date("2026-03-03T17:54:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "kill-switch.activate",
      actor: "oncall",
      targetType: "permission-action",
      severity: "critical",
      reason: "incident",
    });

    vi.setSystemTime(new Date("2026-03-03T17:55:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "user-1",
      targetId: "apr_1",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:56:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.approve",
      actor: "approver",
      targetId: "apr_1",
      targetType: "approval-request",
      severity: "info",
      metadata: { requestStatus: "approved" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:57:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.expire",
      actor: "system",
      targetId: "apr_2",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "expired" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:58:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "kill-switch.deactivate",
      actor: "oncall",
      targetType: "permission-action",
      severity: "warning",
      reason: "incident resolved",
    });

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const aggregator = new PolicyNotificationAggregator({
      auditStorage,
      denialSpikeWindows: [{ id: "5m", durationMs: 5 * 60_000, threshold: 99 }],
      now: () => new Date(),
    });

    const notifications = await aggregator.aggregate({
      startTime: new Date("2026-03-03T17:53:00.000Z"),
      endTime: new Date("2026-03-03T18:00:00.000Z"),
    });

    expect(notifications.map((item) => item.type)).toEqual([
      "kill-switch.state-change",
      "approval.request",
      "approval.decision",
      "approval.timeout",
      "kill-switch.state-change",
    ]);

    expect(notifications.map((item) => item.title)).toEqual([
      "Kill-switch activating",
      "Approval required",
      "Approval granted",
      "Approval timed out",
      "Kill-switch deactivated",
    ]);
  });

  it("detects denial spikes using configured deterministic windows", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    for (let minute = 0; minute < 5; minute += 1) {
      vi.setSystemTime(new Date(`2026-03-03T17:${55 + minute}:00.000Z`));
      await auditStorage.append({
        category: "access",
        action: `permission.tool.execute.${minute}`,
        actor: "user-1",
        targetType: "tool",
        severity: "warning",
        metadata: { result: "deny" },
      });
    }

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const aggregator = new PolicyNotificationAggregator({
      auditStorage,
      denialSpikeWindows: [
        { id: "5m", durationMs: 5 * 60_000, threshold: 4 },
        { id: "10m", durationMs: 10 * 60_000, threshold: 8 },
      ],
      now: () => new Date(),
    });

    const notifications = await aggregator.aggregate({
      startTime: new Date("2026-03-03T17:50:00.000Z"),
      endTime: new Date("2026-03-03T18:00:00.000Z"),
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "denial.spike",
      severity: "critical",
      metadata: {
        windowId: "5m",
        threshold: 4,
        denialCount: 5,
      },
    });

    expect(notifications[0]?.id).toBe("denial-spike:5m:2026-03-03T18:00:00.000Z");
  });
});
