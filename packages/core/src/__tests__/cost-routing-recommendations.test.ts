import { describe, expect, it } from "vitest";
import {
  buildAutoModelRoutingRules,
  generateModelRoutingRecommendations,
} from "../cost-routing-recommendations.js";
import type { ModelPricing, UsageEvent } from "../cost-schema.js";

describe("cost-routing-recommendations (COST-010)", () => {
  it("generates recommendations by task type with estimated savings and confidence", () => {
    const pricing = createPricing([
      {
        provider: "openai",
        model: "gpt-4o",
        inputCostPerMillion: 10,
        outputCostPerMillion: 30,
      },
      {
        provider: "openai",
        model: "gpt-4o-mini",
        inputCostPerMillion: 1,
        outputCostPerMillion: 2,
      },
    ]);

    const events = Array.from({ length: 6 }, (_, index) =>
      createLlmEvent(`evt-${index}`, "openai", "gpt-4o", "code", 10_000, 5_000),
    );

    const recommendations = generateModelRoutingRecommendations(events, pricing, { minEvents: 5 });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      taskType: "code",
      provider: "openai",
      currentModel: "gpt-4o",
      suggestedModel: "gpt-4o-mini",
      eventCount: 6,
    });
    expect(recommendations[0]?.estimatedSavings).toBeGreaterThan(0);
    expect(recommendations[0]?.confidence).toBeGreaterThan(0);
  });

  it("builds automatic routing rules from recommendation thresholds", () => {
    const rules = buildAutoModelRoutingRules(
      [
        {
          taskType: "analysis",
          provider: "openai",
          currentModel: "gpt-4o",
          suggestedModel: "gpt-4o-mini",
          currentCost: 1,
          suggestedCost: 0.2,
          estimatedSavings: 0.8,
          confidence: 0.9,
          eventCount: 10,
        },
      ],
      {
        enabled: true,
        minimumConfidence: 0.85,
        minimumSavingsUsd: 0.5,
      },
    );

    expect(rules).toEqual([
      {
        taskType: "analysis",
        provider: "openai",
        fromModel: "gpt-4o",
        toModel: "gpt-4o-mini",
        confidence: 0.9,
        estimatedSavings: 0.8,
      },
    ]);
  });
});

function createPricing(
  models: Array<{
    provider: string;
    model: string;
    inputCostPerMillion: number;
    outputCostPerMillion: number;
  }>,
): Map<string, ModelPricing> {
  return new Map(
    models.map((model) => [
      `${model.provider}/${model.model}`,
      {
        ...model,
        effectiveDate: "2026-01-01",
        currency: "USD",
      },
    ]),
  );
}

function createLlmEvent(
  id: string,
  provider: string,
  model: string,
  taskType: string,
  inputTokens: number,
  outputTokens: number,
): UsageEvent {
  return {
    id,
    type: "llm-call",
    timestamp: "2026-03-03T18:00:00.000Z",
    attribution: {
      toolCategory: taskType,
      sessionId: "session-1",
    },
    data: {
      provider,
      model,
      inputTokens,
      outputTokens,
      success: true,
    },
  };
}
