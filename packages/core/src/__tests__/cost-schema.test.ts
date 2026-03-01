import { describe, expect, it } from "vitest";
import {
  aggregateUsage,
  type BudgetAlert,
  type CostCap,
  calculateLlmCost,
  isCostCapExceeded,
  type LlmUsage,
  type ModelPricing,
  shouldFireAlert,
  type UsageEvent,
} from "../cost-schema.js";

describe("cost-schema", () => {
  const samplePricing: ModelPricing = {
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputCostPerMillion: 3.0,
    outputCostPerMillion: 15.0,
    cacheReadCostPerMillion: 0.3,
    cacheWriteCostPerMillion: 3.75,
    effectiveDate: "2026-01-01",
    currency: "USD",
  };

  const sampleLlmUsage: LlmUsage = {
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputTokens: 1000,
    outputTokens: 500,
    success: true,
  };

  describe("calculateLlmCost", () => {
    it("calculates basic input/output cost", () => {
      const cost = calculateLlmCost(sampleLlmUsage, samplePricing);
      // 1000 input tokens = $0.003
      // 500 output tokens = $0.0075
      // Total = $0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it("includes cache costs when present", () => {
      const usageWithCache: LlmUsage = {
        ...sampleLlmUsage,
        cacheReadTokens: 500,
        cacheWriteTokens: 200,
      };
      const cost = calculateLlmCost(usageWithCache, samplePricing);
      // Base: $0.0105
      // Cache read: 500 tokens = $0.00015
      // Cache write: 200 tokens = $0.00075
      // Total = $0.0114
      expect(cost).toBeCloseTo(0.0114, 6);
    });

    it("returns 0 for zero tokens", () => {
      const zeroUsage: LlmUsage = {
        ...sampleLlmUsage,
        inputTokens: 0,
        outputTokens: 0,
      };
      const cost = calculateLlmCost(zeroUsage, samplePricing);
      expect(cost).toBe(0);
    });
  });

  describe("isCostCapExceeded", () => {
    const cap: CostCap = {
      id: "cap-1",
      name: "Daily Cap",
      maxAmount: 100,
      period: "daily",
      scope: { teamId: "team-a" },
      action: "block",
      enabled: true,
    };

    it("returns true when cost exceeds cap", () => {
      expect(isCostCapExceeded(150, cap)).toBe(true);
    });

    it("returns true when cost equals cap", () => {
      expect(isCostCapExceeded(100, cap)).toBe(true);
    });

    it("returns false when cost below cap", () => {
      expect(isCostCapExceeded(50, cap)).toBe(false);
    });

    it("returns false when cap is disabled", () => {
      const disabledCap = { ...cap, enabled: false };
      expect(isCostCapExceeded(150, disabledCap)).toBe(false);
    });
  });

  describe("shouldFireAlert", () => {
    const alert: BudgetAlert = {
      id: "alert-1",
      name: "High Usage Alert",
      threshold: 80,
      period: "monthly",
      recipients: ["admin@example.com"],
      enabled: true,
      channels: ["email"],
    };

    it("returns true when cost exceeds threshold", () => {
      expect(shouldFireAlert(100, alert)).toBe(true);
    });

    it("returns true when cost equals threshold", () => {
      expect(shouldFireAlert(80, alert)).toBe(true);
    });

    it("returns false when cost below threshold", () => {
      expect(shouldFireAlert(50, alert)).toBe(false);
    });

    it("returns false when alert is disabled", () => {
      const disabledAlert = { ...alert, enabled: false };
      expect(shouldFireAlert(100, disabledAlert)).toBe(false);
    });
  });

  describe("aggregateUsage", () => {
    const pricingMap = new Map<string, ModelPricing>([
      ["anthropic/claude-sonnet-4", samplePricing],
    ]);

    const events: UsageEvent[] = [
      {
        id: "evt-1",
        type: "llm-call",
        timestamp: "2026-01-15T10:00:00Z",
        attribution: { userId: "user-1", teamId: "team-a" },
        data: sampleLlmUsage,
      },
      {
        id: "evt-2",
        type: "llm-call",
        timestamp: "2026-01-15T11:00:00Z",
        attribution: { userId: "user-1", teamId: "team-a" },
        data: { ...sampleLlmUsage, inputTokens: 2000, outputTokens: 1000 },
      },
      {
        id: "evt-3",
        type: "skill-invocation",
        timestamp: "2026-01-15T12:00:00Z",
        attribution: { userId: "user-1", skillId: "acme/code-review" },
        data: { skillId: "acme/code-review", version: "1.0.0", success: true },
      },
    ];

    it("aggregates costs by type", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.byType["llm-call"]).toBeGreaterThan(0);
      expect(summary.byType["skill-invocation"]).toBeDefined();
    });

    it("aggregates costs by provider", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.byProvider?.["anthropic"]).toBeGreaterThan(0);
    });

    it("aggregates token counts", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.tokenCounts?.input).toBe(3000);
      expect(summary.tokenCounts?.output).toBe(1500);
    });

    it("calculates total cost", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      // Event 1: $0.0105
      // Event 2: $0.021 (2x input, 2x output)
      // Total LLM: $0.0315
      expect(summary.totalCost).toBeCloseTo(0.0315, 4);
    });

    it("sets period boundaries", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.periodStart).toBe("2026-01-15");
      expect(summary.periodEnd).toBe("2026-01-16");
    });
  });
});
