import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { SecurityDashboardService } from "../../policy/security-dashboard.js";

describe("SecurityDashboardService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates security posture metrics over configured windows", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    // Outside 10m window, inside 1h window.
    vi.setSystemTime(new Date("2026-03-03T17:40:00.000Z"));
    await auditStorage.append({
      category: "auth",
      action: "authenticate.failure",
      actor: "anonymous",
      targetType: "api-request",
      severity: "warning",
    });

    vi.setSystemTime(new Date("2026-03-03T17:53:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "hook.pre.veto",
      actor: "user-1",
      targetId: "tool:shell",
      targetType: "hook",
      severity: "warning",
    });

    vi.setSystemTime(new Date("2026-03-03T17:54:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "rate-limit.enforce.deny",
      actor: "user-1",
      targetType: "project",
      severity: "warning",
    });

    vi.setSystemTime(new Date("2026-03-03T17:56:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "resource-guard.enforce.deny",
      actor: "user-1",
      targetId: "https://bad.example",
      targetType: "url",
      severity: "warning",
    });

    vi.setSystemTime(new Date("2026-03-03T17:57:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "user-2",
      targetId: "apr_a",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:58:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "user-3",
      targetId: "apr_b",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:59:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.approve",
      actor: "admin-1",
      targetId: "apr_b",
      targetType: "approval-request",
      severity: "info",
      metadata: { requestStatus: "approved" },
    });

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const service = new SecurityDashboardService({
      auditStorage,
      windows: [
        { id: "10m", durationMs: 10 * 60_000 },
        { id: "1h", durationMs: 60 * 60_000 },
      ],
      now: () => new Date(),
      killSwitchStateProvider: () => ({
        status: "active",
        activeAt: "2026-03-03T17:55:00.000Z",
        activatedBy: "oncall",
      }),
    });

    const snapshot = await service.snapshot();

    expect(snapshot.killSwitch.status).toBe("active");
    expect(snapshot.windows.map((window) => window.id)).toEqual(["10m", "1h"]);

    const tenMinute = snapshot.windows[0];
    expect(tenMinute).toBeDefined();
    expect(tenMinute?.metrics).toEqual({
      authFailures: 0,
      hookVetoes: 1,
      rateLimitDenials: 1,
      guardDenials: 1,
      pendingApprovals: 1,
    });

    const oneHour = snapshot.windows[1];
    expect(oneHour).toBeDefined();
    expect(oneHour?.metrics).toEqual({
      authFailures: 1,
      hookVetoes: 1,
      rateLimitDenials: 1,
      guardDenials: 1,
      pendingApprovals: 1,
    });
  });

  it("filters approval pending state by latest decision and window start", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    // Pending request older than window should not count.
    vi.setSystemTime(new Date("2026-03-03T17:44:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "user-old",
      targetId: "apr_old",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    // Request created in window and later denied should not count as pending.
    vi.setSystemTime(new Date("2026-03-03T17:55:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "user-window",
      targetId: "apr_denied",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:58:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.deny",
      actor: "approver",
      targetId: "apr_denied",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "denied" },
    });

    vi.setSystemTime(new Date("2026-03-03T17:59:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "user-live",
      targetId: "apr_live",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const service = new SecurityDashboardService({
      auditStorage,
      windows: [{ id: "10m", durationMs: 10 * 60_000 }],
      now: () => new Date(),
    });

    const snapshot = await service.snapshot();
    expect(snapshot.windows[0]?.metrics.pendingApprovals).toBe(1);
  });
});
