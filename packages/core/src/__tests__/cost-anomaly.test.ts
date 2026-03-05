import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../audit-storage.js";
import { CostAnomalyDetector } from "../cost-anomaly.js";
import type { UsageEvent } from "../cost-schema.js";
import { InMemoryUsageStorage } from "../usage-storage.js";

describe("CostAnomalyDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects developer and project token spikes against rolling historical baseline", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    for (let hour = 24; hour >= 1; hour -= 1) {
      const timestamp = new Date(Date.parse("2026-03-03T18:00:00.000Z") - hour * 60 * 60_000);
      await store(usageStorage, timestamp.toISOString(), {
        developerId: "dev-1",
        projectId: "proj-1",
        inputTokens: 50,
        outputTokens: 50,
      });
    }

    await store(usageStorage, "2026-03-03T17:50:00.000Z", {
      developerId: "dev-1",
      projectId: "proj-1",
      inputTokens: 300,
      outputTokens: 300,
    });

    const detector = new CostAnomalyDetector({
      usageStorage,
      auditStorage,
      now: () => new Date(),
    });

    const report = await detector.detect();

    expect(report.anomalies).toHaveLength(2);
    expect(report.anomalies.map((anomaly) => anomaly.dimension).sort()).toEqual([
      "developerId",
      "projectId",
    ]);

    expect(report.anomalies[0]?.ratio).toBeGreaterThanOrEqual(6);

    const auditPage = await auditStorage.query({ action: "cost.anomaly.detected" }, 20, 0);
    expect(auditPage.total).toBe(2);
    expect(auditPage.entries[0]?.targetType).toBe("cost-anomaly");
  });

  it("uses default 5x threshold + 1 hour window and records PERM-017 channel metadata", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    for (let hour = 24; hour >= 1; hour -= 1) {
      const timestamp = new Date(Date.parse("2026-03-03T18:00:00.000Z") - hour * 60 * 60_000);
      await store(usageStorage, timestamp.toISOString(), {
        developerId: "dev-defaults",
        projectId: "proj-defaults",
        inputTokens: 50,
        outputTokens: 50,
      });
    }

    await store(usageStorage, "2026-03-03T17:50:00.000Z", {
      developerId: "dev-defaults",
      projectId: "proj-defaults",
      inputTokens: 250,
      outputTokens: 250,
    });

    const detector = new CostAnomalyDetector({
      usageStorage,
      auditStorage,
      dimensions: ["developerId"],
      now: () => new Date(),
    });

    const report = await detector.detect();

    expect(report.thresholdMultiplier).toBe(5);
    expect(report.detectionWindowMs).toBe(60 * 60_000);
    expect(report.anomalies).toHaveLength(1);
    expect(report.anomalies[0]?.ratio).toBeGreaterThanOrEqual(5);

    const auditPage = await auditStorage.query({ action: "cost.anomaly.detected" }, 10, 0);
    expect(auditPage.total).toBe(1);
    expect(auditPage.entries[0]?.metadata).toMatchObject({
      channels: ["email"],
      dimension: "developerId",
      subject: "dev-defaults",
    });
  });

  it("supports configurable threshold, detection window, and notification channels", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const sender = vi.fn(async () => {});

    for (let window = 4; window >= 1; window -= 1) {
      const timestamp = new Date(Date.parse("2026-03-03T18:00:00.000Z") - window * 30 * 60_000);
      await store(usageStorage, timestamp.toISOString(), {
        developerId: "dev-2",
        projectId: "proj-2",
        inputTokens: 50,
        outputTokens: 50,
      });
    }

    await store(usageStorage, "2026-03-03T17:55:00.000Z", {
      developerId: "dev-2",
      projectId: "proj-2",
      inputTokens: 100,
      outputTokens: 100,
    });

    const detector = new CostAnomalyDetector({
      usageStorage,
      auditStorage,
      detectionWindowMs: 30 * 60_000,
      baselineWindowCount: 4,
      thresholdMultiplier: 1.5,
      dimensions: ["developerId"],
      channels: ["email", "slack"],
      notificationSender: sender,
      now: () => new Date(),
    });

    const report = await detector.detect();

    expect(report.anomalies).toHaveLength(1);
    expect(report.anomalies[0]?.subject).toBe("dev-2");
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenNthCalledWith(1, "email", report.anomalies[0]);
    expect(sender).toHaveBeenNthCalledWith(2, "slack", report.anomalies[0]);
  });
});

async function store(
  storage: InMemoryUsageStorage,
  timestamp: string,
  data: {
    developerId: string;
    projectId: string;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  const event: UsageEvent = {
    id: `evt_${timestamp}`,
    timestamp,
    type: "llm-call",
    attribution: {
      developerId: data.developerId,
      projectId: data.projectId,
    },
    data: {
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      durationMs: 100,
      success: true,
    },
  };

  await storage.store(event);
}
