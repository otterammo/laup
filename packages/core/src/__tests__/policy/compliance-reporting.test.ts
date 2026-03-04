import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import {
  ComplianceReportSchema,
  ComplianceReportService,
  getComplianceProfileDefinition,
} from "../../policy/compliance-reporting.js";

describe("ComplianceReportService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T20:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates deterministic SOC 2 report with mapped evidence sections", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    vi.setSystemTime(new Date("2026-03-03T19:45:00.000Z"));
    await auditStorage.append({
      category: "access",
      action: "approval.request",
      actor: "analyst",
      targetId: "apr_1",
      targetType: "approval-request",
      severity: "warning",
      metadata: { requestStatus: "pending" },
    });

    vi.setSystemTime(new Date("2026-03-03T19:48:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "permission.anomaly.deny-rate-spike",
      actor: "system",
      severity: "critical",
      metadata: { window: "5m" },
    });

    vi.setSystemTime(new Date("2026-03-03T19:50:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "kill-switch.activate",
      actor: "oncall",
      severity: "critical",
      reason: "incident",
    });

    vi.setSystemTime(new Date("2026-03-03T19:52:00.000Z"));
    await auditStorage.append({
      category: "config",
      action: "policy.deploy",
      actor: "release-bot",
      severity: "info",
      metadata: { revision: "abc123" },
    });

    vi.setSystemTime(new Date("2026-03-03T20:00:00.000Z"));

    const service = new ComplianceReportService({
      auditStorage,
      now: () => new Date(),
    });

    const report = await service.generate({
      profile: "soc2",
      startTime: new Date("2026-03-03T19:40:00.000Z"),
      endTime: new Date("2026-03-03T20:00:00.000Z"),
    });

    expect(() => ComplianceReportSchema.parse(report)).not.toThrow();
    expect(report.reportId).toBe(
      "compliance:soc2:2026-03-03T19:40:00.000Z:2026-03-03T20:00:00.000Z",
    );
    expect(report.controls.map((control) => control.controlId)).toEqual([
      "CC6.1",
      "CC7.2",
      "CC7.3",
      "CC8.1",
    ]);
    expect(report.summary.totalEvents).toBe(4);
    expect(report.summary.controlsCovered).toBe(4);
    expect(report.summary.eventsByCategory).toEqual({
      access: 1,
      security: 2,
      config: 1,
    });

    const cc72 = report.controls.find((control) => control.controlId === "CC7.2");
    expect(cc72?.evidence.map((evidence) => evidence.action)).toEqual([
      "permission.anomaly.deny-rate-spike",
    ]);

    expect(report.evidenceIndex.map((evidence) => evidence.sourceEventId)).toEqual([
      "aud_1",
      "aud_2",
      "aud_3",
      "aud_4",
    ]);
  });

  it("applies range filtering and can serialize evidence as jsonl", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));
    await auditStorage.append({
      category: "security",
      action: "kill-switch.activate",
      actor: "oncall",
      severity: "critical",
    });

    vi.setSystemTime(new Date("2026-03-03T19:00:00.000Z"));
    await auditStorage.append({
      category: "auth",
      action: "authenticate.failure",
      actor: "user-1",
      severity: "warning",
    });

    vi.setSystemTime(new Date("2026-03-03T20:00:00.000Z"));

    const service = new ComplianceReportService({ auditStorage, now: () => new Date() });

    const report = await service.generate({
      profile: "iso27001",
      startTime: new Date("2026-03-03T18:30:00.000Z"),
      endTime: new Date("2026-03-03T20:00:00.000Z"),
    });

    expect(report.summary.totalEvents).toBe(1);
    expect(report.evidenceIndex).toHaveLength(1);
    expect(report.evidenceIndex[0]?.action).toBe("authenticate.failure");

    const jsonl = await service.generateSerialized(
      {
        profile: "iso27001",
        startTime: new Date("2026-03-03T18:30:00.000Z"),
        endTime: new Date("2026-03-03T20:00:00.000Z"),
      },
      "jsonl",
    );

    const lines = jsonl.split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ action: "authenticate.failure" });
  });
});

describe("compliance profile definitions", () => {
  it("exposes deterministic control mappings for SOC 2 and ISO 27001", () => {
    const soc2 = getComplianceProfileDefinition("soc2");
    const iso = getComplianceProfileDefinition("iso27001");

    expect(soc2.controls.map((control) => control.controlId)).toEqual([
      "CC6.1",
      "CC7.2",
      "CC7.3",
      "CC8.1",
    ]);
    expect(iso.controls.map((control) => control.controlId)).toEqual([
      "A.5.15",
      "A.5.24",
      "A.8.15",
      "A.8.16",
    ]);
  });
});
