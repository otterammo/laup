import { z } from "zod";
import {
  calculateLlmCost,
  type LlmUsage,
  type ModelPricing,
  type UsageEvent,
} from "./cost-schema.js";

export const ModelRoutingRecommendationSchema = z.object({
  taskType: z.string(),
  provider: z.string(),
  currentModel: z.string(),
  suggestedModel: z.string(),
  currentCost: z.number().nonnegative(),
  suggestedCost: z.number().nonnegative(),
  estimatedSavings: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  eventCount: z.number().int().positive(),
});

export type ModelRoutingRecommendation = z.infer<typeof ModelRoutingRecommendationSchema>;

export const AutoModelRoutingPolicySchema = z.object({
  enabled: z.boolean().default(false),
  minimumConfidence: z.number().min(0).max(1).default(0.75),
  minimumSavingsUsd: z.number().nonnegative().default(0),
});

export type AutoModelRoutingPolicy = z.infer<typeof AutoModelRoutingPolicySchema>;

export interface AutoModelRoutingRule {
  taskType: string;
  provider: string;
  fromModel: string;
  toModel: string;
  confidence: number;
  estimatedSavings: number;
}

export interface ModelRoutingRecommendationOptions {
  minEvents?: number;
  maxRecommendations?: number;
}

interface ModelUsagePattern {
  provider: string;
  model: string;
  taskType: string;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  successCount: number;
}

export function generateModelRoutingRecommendations(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
  options: ModelRoutingRecommendationOptions = {},
): ModelRoutingRecommendation[] {
  const minEvents = options.minEvents ?? 5;
  const maxRecommendations = options.maxRecommendations ?? 20;

  const patterns = aggregatePatterns(events);
  const recommendations: ModelRoutingRecommendation[] = [];

  for (const pattern of patterns) {
    if (pattern.eventCount < minEvents) {
      continue;
    }

    const currentPricing = pricing.get(`${pattern.provider}/${pattern.model}`);
    if (!currentPricing) {
      continue;
    }

    const currentCost = estimateCost(pattern, currentPricing);

    let bestAlternative: { model: string; cost: number } | null = null;
    for (const candidate of pricing.values()) {
      if (candidate.provider !== pattern.provider || candidate.model === pattern.model) {
        continue;
      }

      const candidateCost = estimateCost(pattern, candidate);
      if (candidateCost >= currentCost) {
        continue;
      }

      if (!bestAlternative || candidateCost < bestAlternative.cost) {
        bestAlternative = { model: candidate.model, cost: candidateCost };
      }
    }

    if (!bestAlternative) {
      continue;
    }

    const estimatedSavings = currentCost - bestAlternative.cost;
    const confidence = computeConfidence(pattern);

    recommendations.push({
      taskType: pattern.taskType,
      provider: pattern.provider,
      currentModel: pattern.model,
      suggestedModel: bestAlternative.model,
      currentCost,
      suggestedCost: bestAlternative.cost,
      estimatedSavings,
      confidence,
      eventCount: pattern.eventCount,
    });
  }

  return recommendations
    .sort((a, b) => b.estimatedSavings - a.estimatedSavings || b.confidence - a.confidence)
    .slice(0, maxRecommendations);
}

export function buildAutoModelRoutingRules(
  recommendations: ModelRoutingRecommendation[],
  policy: AutoModelRoutingPolicy,
): AutoModelRoutingRule[] {
  if (!policy.enabled) {
    return [];
  }

  return recommendations
    .filter(
      (recommendation) =>
        recommendation.confidence >= policy.minimumConfidence &&
        recommendation.estimatedSavings >= policy.minimumSavingsUsd,
    )
    .map((recommendation) => ({
      taskType: recommendation.taskType,
      provider: recommendation.provider,
      fromModel: recommendation.currentModel,
      toModel: recommendation.suggestedModel,
      confidence: recommendation.confidence,
      estimatedSavings: recommendation.estimatedSavings,
    }));
}

function aggregatePatterns(events: UsageEvent[]): ModelUsagePattern[] {
  const groups = new Map<string, ModelUsagePattern>();

  for (const event of events) {
    if (event.type !== "llm-call") {
      continue;
    }

    const usage = event.data as LlmUsage;
    const taskType = event.attribution.toolCategory ?? event.attribution.skillId ?? "general";
    const key = `${usage.provider}/${usage.model}/${taskType}`;

    const existing = groups.get(key) ?? {
      provider: usage.provider,
      model: usage.model,
      taskType,
      eventCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      successCount: 0,
    };

    existing.eventCount += 1;
    existing.inputTokens += usage.inputTokens;
    existing.outputTokens += usage.outputTokens;
    existing.successCount += usage.success ? 1 : 0;

    groups.set(key, existing);
  }

  return Array.from(groups.values());
}

function estimateCost(pattern: ModelUsagePattern, pricing: ModelPricing): number {
  return calculateLlmCost(
    {
      provider: pattern.provider,
      model: pricing.model,
      inputTokens: pattern.inputTokens,
      outputTokens: pattern.outputTokens,
      success: true,
    },
    pricing,
  );
}

function computeConfidence(pattern: ModelUsagePattern): number {
  const sampleConfidence = Math.min(pattern.eventCount / 20, 1) * 0.6;
  const successRate = pattern.successCount / pattern.eventCount;
  const successConfidence = successRate * 0.4;
  return Number(Math.min(sampleConfidence + successConfidence, 1).toFixed(4));
}
