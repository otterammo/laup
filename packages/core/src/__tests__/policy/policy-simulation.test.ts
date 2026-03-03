import { describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { PermissionAuditLogger } from "../../policy/permission-audit.js";
import type { Policy } from "../../policy/policy-evaluator.js";
import { PolicySimulationService } from "../../policy/policy-simulation.js";

describe("PolicySimulationService", () => {
  it("replays historical audit actions against candidate policies and returns deltas", async () => {
    vi.useFakeTimers();
    const storage = new InMemoryAuditStorage();
    const logger = new PermissionAuditLogger(storage);
    await logger.init();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "read",
      resource: "doc-1",
      resourceType: "document",
      result: "allow",
      context: {
        actorType: "user",
        scopeChain: [{ scope: "org", id: "org-1" }],
      },
    });

    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "write",
      resource: "doc-1",
      resourceType: "document",
      result: "allow",
      context: {
        actorType: "user",
        scopeChain: [{ scope: "org", id: "org-1" }],
      },
    });

    const candidate: Policy[] = [
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

    const simulator = new PolicySimulationService(logger);
    const result = await simulator.simulate({ candidatePolicies: candidate });

    expect(result.summary.totalRecords).toBe(2);
    expect(result.summary.changedFromHistoricalCount).toBe(1);
    expect(result.summary.historicalAllowToDenyCount).toBe(1);
    expect(result.summary.historicalDenyToAllowCount).toBe(0);

    const writeRecord = result.records.find((record) => record.action === "write");
    expect(writeRecord?.historical).toBe("allow");
    expect(writeRecord?.candidate).toBe("deny");
    expect(writeRecord?.historicalToCandidateDelta).toBe("allow_to_deny");

    vi.useRealTimers();
  });

  it("supports baseline policy set comparison and date range filters", async () => {
    vi.useFakeTimers();
    const storage = new InMemoryAuditStorage();
    const logger = new PermissionAuditLogger(storage);
    await logger.init();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "read",
      resource: "doc-1",
      resourceType: "document",
      result: "allow",
      context: { scopeChain: [{ scope: "org", id: "org-1" }] },
    });

    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));
    await logger.logEvaluation({
      actor: "alice",
      action: "delete",
      resource: "doc-1",
      resourceType: "document",
      result: "deny",
      context: { scopeChain: [{ scope: "org", id: "org-1" }] },
    });

    const baseline: Policy[] = [
      {
        id: "baseline-allow-delete",
        name: "Baseline allow delete",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["delete"],
        resourceTypes: ["document"],
      },
    ];

    const candidate: Policy[] = [];

    const simulator = new PolicySimulationService(logger);
    const result = await simulator.simulate({
      candidatePolicies: candidate,
      baselinePolicies: baseline,
      auditFilter: {
        startTime: new Date("2026-01-05T00:00:00.000Z"),
      },
    });

    expect(result.summary.totalRecords).toBe(1);
    expect(result.summary.changedFromBaselineCount).toBe(1);
    expect(result.summary.baselineAllowToDenyCount).toBe(1);

    const [record] = result.records;
    expect(record?.baseline).toBe("allow");
    expect(record?.candidate).toBe("deny");
    expect(record?.baselineToCandidateDelta).toBe("allow_to_deny");

    vi.useRealTimers();
  });

  it("produces deterministic record ordering and tolerates missing context", async () => {
    vi.useFakeTimers();
    const storage = new InMemoryAuditStorage();
    const logger = new PermissionAuditLogger(storage);
    await logger.init();

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const idA = await logger.logEvaluation({
      actor: "bob",
      action: "read",
      resource: "doc-a",
      resourceType: "document",
      result: "deny",
    });

    const idB = await logger.logEvaluation({
      actor: "alice",
      action: "read",
      resource: "doc-b",
      resourceType: "document",
      result: "deny",
    });

    const simulator = new PolicySimulationService(logger);
    const result = await simulator.simulate({ candidatePolicies: [] });

    expect(result.records.map((record) => record.auditId)).toEqual([idA, idB].sort());
    expect(result.records.every((record) => record.candidate === "deny")).toBe(true);

    vi.useRealTimers();
  });
});
