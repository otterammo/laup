import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { PermissionAnomalyDetector } from "../../policy/permission-anomaly.js";
import { PermissionAuditLogger } from "../../policy/permission-audit.js";

describe("PermissionAnomalyDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects deny-rate spikes against baseline", async () => {
    const logger = await createLogger();

    // Baseline: 40 evaluations, 4 denies (10%).
    for (let i = 0; i < 36; i += 1) {
      await logEval(logger, "2026-03-03T17:43:00.000Z", { result: "allow" });
    }
    for (let i = 0; i < 4; i += 1) {
      await logEval(logger, "2026-03-03T17:44:00.000Z", { result: "deny" });
    }

    // Current window: 20 evaluations, 16 denies (80%).
    for (let i = 0; i < 4; i += 1) {
      await logEval(logger, "2026-03-03T17:58:00.000Z", { result: "allow" });
    }
    for (let i = 0; i < 16; i += 1) {
      await logEval(logger, "2026-03-03T17:59:00.000Z", { result: "deny" });
    }

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const detector = new PermissionAnomalyDetector({
      auditLogger: logger,
      windows: [{ id: "15m", durationMs: 15 * 60_000, baselineDurationMs: 60 * 60_000 }],
      now: () => new Date(),
      thresholds: {
        denyRateSpike: {
          minCurrentEvaluations: 10,
          minBaselineEvaluations: 20,
          spikeMultiplier: 2,
          minAbsoluteIncrease: 0.2,
          absoluteRateThreshold: 0.5,
        },
      },
    });

    const report = await detector.detect();
    const anomalies = report.windows[0]?.anomalies ?? [];
    expect(anomalies.some((anomaly) => anomaly.type === "deny-rate-spike")).toBe(true);
    expect(report.summary.byType["deny-rate-spike"]).toBe(1);
  });

  it("detects unusual actor/tool burst patterns", async () => {
    const logger = await createLogger();

    // Baseline: actor/tool pair appears once.
    await logEval(logger, "2026-03-03T17:20:00.000Z", {
      actor: "alice",
      tool: "shell",
      result: "allow",
    });

    // Current: same actor/tool bursts.
    for (let i = 0; i < 8; i += 1) {
      await logEval(logger, "2026-03-03T17:56:00.000Z", {
        actor: "alice",
        tool: "shell",
        result: "allow",
      });
    }

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const detector = new PermissionAnomalyDetector({
      auditLogger: logger,
      windows: [{ id: "10m", durationMs: 10 * 60_000, baselineDurationMs: 60 * 60_000 }],
      now: () => new Date(),
      thresholds: {
        actorToolBurst: {
          minEvents: 5,
          multiplier: 2,
          minAbsoluteIncrease: 2,
        },
        baselineDeviation: {
          minCurrentEvaluations: 100,
          minDeviationRatio: 99,
          minAbsoluteDelta: 99,
        },
      },
    });

    const report = await detector.detect();
    const burst = report.windows[0]?.anomalies.find((entry) => entry.type === "actor-tool-burst");

    expect(burst).toBeDefined();
    expect(burst?.dimensions).toEqual({ actor: "alice", tool: "shell" });
  });

  it("detects abrupt baseline deviation and keeps deterministic ordering", async () => {
    const logger = await createLogger();

    // Baseline: low traffic.
    for (let i = 0; i < 12; i += 1) {
      await logEval(logger, "2026-03-03T17:10:00.000Z", { result: "allow" });
    }

    // Current: heavy traffic.
    for (let i = 0; i < 30; i += 1) {
      await logEval(logger, "2026-03-03T17:58:00.000Z", {
        actor: i % 2 === 0 ? "a" : "b",
        tool: i % 3 === 0 ? "shell" : "editor",
        result: "allow",
      });
    }

    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));

    const detector = new PermissionAnomalyDetector({
      auditLogger: logger,
      windows: [{ id: "10m", durationMs: 10 * 60_000, baselineDurationMs: 60 * 60_000 }],
      now: () => new Date(),
      thresholds: {
        denyRateSpike: {
          minCurrentEvaluations: 10,
          minBaselineEvaluations: 10,
          spikeMultiplier: 2,
          minAbsoluteIncrease: 0.2,
          absoluteRateThreshold: 0.5,
        },
        baselineDeviation: {
          minCurrentEvaluations: 10,
          minDeviationRatio: 1,
          minAbsoluteDelta: 10,
        },
      },
    });

    const reportA = await detector.detect();
    const reportB = await detector.detect();

    const firstWindowA = reportA.windows[0];
    const firstWindowB = reportB.windows[0];

    expect(firstWindowA?.anomalies.some((entry) => entry.type === "baseline-deviation")).toBe(true);
    expect(firstWindowA?.anomalies.map((entry) => entry.id)).toEqual(
      firstWindowB?.anomalies.map((entry) => entry.id),
    );
  });

  it("does not emit anomalies when thresholds are not met", async () => {
    const logger = await createLogger();

    for (let i = 0; i < 20; i += 1) {
      await logEval(logger, "2026-03-03T17:45:00.000Z", {
        result: i % 10 === 0 ? "deny" : "allow",
      });
    }

    for (let i = 0; i < 12; i += 1) {
      await logEval(logger, "2026-03-03T17:56:00.000Z", { result: i % 6 === 0 ? "deny" : "allow" });
    }

    const detector = new PermissionAnomalyDetector({
      auditLogger: logger,
      windows: [{ id: "10m", durationMs: 10 * 60_000, baselineDurationMs: 60 * 60_000 }],
      now: () => new Date(),
      thresholds: {
        denyRateSpike: {
          minCurrentEvaluations: 10,
          minBaselineEvaluations: 10,
          spikeMultiplier: 3,
          minAbsoluteIncrease: 0.4,
          absoluteRateThreshold: 0.7,
        },
        actorToolBurst: {
          minEvents: 50,
          multiplier: 5,
          minAbsoluteIncrease: 20,
        },
        baselineDeviation: {
          minCurrentEvaluations: 20,
          minDeviationRatio: 2,
          minAbsoluteDelta: 20,
        },
      },
    });

    const report = await detector.detect();
    expect(report.summary.totalAnomalies).toBe(0);
    expect(report.windows[0]?.anomalies).toEqual([]);
  });
});

async function createLogger(): Promise<PermissionAuditLogger> {
  const storage = new InMemoryAuditStorage();
  await storage.init();
  const logger = new PermissionAuditLogger(storage);
  await logger.init();
  return logger;
}

async function logEval(
  logger: PermissionAuditLogger,
  timestamp: string,
  input: {
    actor?: string;
    action?: string;
    resource?: string;
    tool?: string;
    result?: "allow" | "deny";
  },
): Promise<void> {
  vi.setSystemTime(new Date(timestamp));
  await logger.logEvaluation({
    actor: input.actor ?? "user-1",
    action: input.action ?? "execute",
    resource: input.resource ?? "tool:shell",
    tool: input.tool,
    result: input.result ?? "allow",
  });
}
