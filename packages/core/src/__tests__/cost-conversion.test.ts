import { describe, expect, it } from "vitest";
import { createCostConversionService, PriceUnavailableError } from "../cost-conversion.js";
import type { LlmUsage, ModelPricing, UsageEvent } from "../cost-schema.js";
import { InMemoryPricingProvider } from "../pricing-provider.js";

describe("cost-conversion", () => {
  const usage: LlmUsage = {
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputTokens: 1_000,
    outputTokens: 500,
    cacheReadTokens: 500,
    cacheWriteTokens: 200,
    success: true,
  };

  const pricing: ModelPricing = {
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    cacheReadCostPerMillion: 0.3,
    cacheWriteCostPerMillion: 3.75,
    effectiveDate: "2026-01-01T00:00:00.000Z",
    currency: "USD",
  };

  it("converts LLM token usage to monetary cost with cache fields", async () => {
    const service = createCostConversionService({
      pricingProvider: new InMemoryPricingProvider({ initialPricing: [pricing] }),
    });

    const result = await service.convertLlmUsage(usage);

    expect(result.totalCost).toBeCloseTo(0.0114, 6);
    expect(result.inputCost).toBeCloseTo(0.003, 6);
    expect(result.outputCost).toBeCloseTo(0.0075, 6);
    expect(result.cacheReadCost).toBeCloseTo(0.00015, 6);
    expect(result.cacheWriteCost).toBeCloseTo(0.00075, 6);
    expect(result.pricingFound).toBe(true);
  });

  it("applies deterministic fallback when pricing is unavailable", async () => {
    const service = createCostConversionService({
      pricingProvider: new InMemoryPricingProvider(),
      fallbackPricing: {
        inputCostPerMillion: 1,
        outputCostPerMillion: 2,
        cacheReadCostPerMillion: 0.25,
        cacheWriteCostPerMillion: 0.5,
      },
    });

    const result = await service.convertLlmUsage(usage);

    expect(result.totalCost).toBeCloseTo(0.002225, 6);
    expect(result.pricingFound).toBe(false);
  });

  it("throws when missing pricing strategy is error", async () => {
    const service = createCostConversionService({
      pricingProvider: new InMemoryPricingProvider(),
      missingPriceStrategy: "error",
    });

    await expect(service.convertLlmUsage(usage)).rejects.toBeInstanceOf(PriceUnavailableError);
  });

  it("refreshes and updates provider pricing", async () => {
    let version = 1;
    const provider = new InMemoryPricingProvider({
      fetchLatest: async () => [
        {
          ...pricing,
          inputCostPerMillion: version === 1 ? 3 : 6,
          effectiveDate: version === 1 ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
        },
      ],
    });

    const service = createCostConversionService({ pricingProvider: provider });

    await service.refreshPricing();
    const first = await service.convertLlmUsage({
      ...usage,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(first.totalCost).toBeCloseTo(0.003, 6);

    version = 2;
    await service.refreshPricing();
    const second = await service.convertLlmUsage({
      ...usage,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(second.totalCost).toBeCloseTo(0.006, 6);
  });

  it("converts mixed usage events into totals", async () => {
    const service = createCostConversionService({
      pricingProvider: new InMemoryPricingProvider({ initialPricing: [pricing] }),
    });

    const events: UsageEvent[] = [
      {
        id: "evt-1",
        type: "llm-call",
        timestamp: "2026-01-01T00:00:00.000Z",
        attribution: {},
        data: usage,
      },
      {
        id: "evt-2",
        type: "skill-invocation",
        timestamp: "2026-01-01T00:01:00.000Z",
        attribution: {},
        data: {
          skillId: "acme/summarize",
          success: true,
        },
      },
    ];

    const totals = await service.convertEvents(events);

    expect(totals.totalCost).toBeCloseTo(0.0114, 6);
    expect(totals.eventCount).toBe(2);
    expect(totals.byType["llm-call"]).toBeCloseTo(0.0114, 6);
    expect(totals.byType["skill-invocation"]).toBe(0);
    expect(totals.missingPricingCount).toBe(0);
  });
});
