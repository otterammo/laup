import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostDashboardService } from "../cost-dashboard.js";
import type { UsageEvent } from "../cost-schema.js";
import { InMemoryPricingProvider } from "../pricing-provider.js";
import { InMemoryUsageStorage } from "../usage-storage.js";

describe("CostDashboardService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-03T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unified real-time and historical cost summaries", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const pricingProvider = new InMemoryPricingProvider({
      initialPricing: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          inputCostPerMillion: 1,
          outputCostPerMillion: 2,
          effectiveDate: "2026-01-01",
          currency: "USD",
        },
      ],
    });

    await store(usageStorage, "2026-03-03T17:20:00.000Z", {
      inputTokens: 1000,
      outputTokens: 500,
    });
    await store(usageStorage, "2026-03-03T17:35:00.000Z", {
      inputTokens: 1000,
      outputTokens: 1000,
    });
    await store(usageStorage, "2026-03-03T17:56:00.000Z", {
      inputTokens: 2000,
      outputTokens: 1000,
    });

    const service = new CostDashboardService({
      usageStorage,
      pricingProvider,
      windows: [
        { id: "5m", durationMs: 5 * 60_000 },
        { id: "1h", durationMs: 60 * 60_000 },
      ],
      historical: { bucket: "hour", points: 2 },
      now: () => new Date(),
    });

    const snapshot = await service.snapshot();

    expect(snapshot.realtime.windowId).toBe("5m");
    expect(snapshot.realtime.summary.totalCost).toBeCloseTo(0.004, 8);
    expect(snapshot.windows[1]?.summary.totalCost).toBeCloseTo(0.009, 8);

    expect(snapshot.historical.bucket).toBe("hour");
    expect(snapshot.historical.points).toHaveLength(2);
    expect(snapshot.historical.points[0]?.summary.totalCost).toBe(0);
    expect(snapshot.historical.points[1]?.summary.totalCost).toBeCloseTo(0.009, 8);
  });

  it("keeps token and event counts when pricing is unavailable", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const pricingProvider = new InMemoryPricingProvider();

    await store(usageStorage, "2026-03-03T17:59:00.000Z", {
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      inputTokens: 200,
      outputTokens: 100,
    });

    const service = new CostDashboardService({
      usageStorage,
      pricingProvider,
      windows: [{ id: "10m", durationMs: 10 * 60_000 }],
      now: () => new Date(),
    });

    const snapshot = await service.snapshot();
    expect(snapshot.realtime.summary.totalCost).toBe(0);
    expect(snapshot.realtime.summary.tokenCounts).toEqual({
      input: 200,
      output: 100,
    });
    expect(snapshot.realtime.summary.byType["llm-call"]).toBe(0);
  });
});

async function store(
  storage: InMemoryUsageStorage,
  timestamp: string,
  data: {
    provider?: string;
    model?: string;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  const event: UsageEvent = {
    id: `evt_${timestamp}`,
    timestamp,
    type: "llm-call",
    attribution: {
      developerId: "dev-1",
      teamId: "team-1",
      projectId: "proj-1",
      sessionId: "session-1",
      adapterId: "adapter-1",
    },
    data: {
      provider: data.provider ?? "openai",
      model: data.model ?? "gpt-4o-mini",
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      durationMs: 250,
      success: true,
    },
  };

  await storage.store(event);
}
