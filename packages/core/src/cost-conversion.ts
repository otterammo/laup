import type { LlmUsage, ModelPricing, UsageEvent } from "./cost-schema.js";
import { calculateLlmCost } from "./cost-schema.js";
import type { PricingProvider } from "./pricing-provider.js";

export type MissingPriceStrategy = "zero" | "error";

export interface FallbackPricing {
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  currency?: string;
}

export interface CostConversionOptions {
  pricingProvider: PricingProvider;
  missingPriceStrategy?: MissingPriceStrategy;
  fallbackPricing?: FallbackPricing;
}

export interface LlmCostBreakdown {
  provider: string;
  model: string;
  currency: string;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
  pricingFound: boolean;
}

export interface UsageEventCost {
  eventId: string;
  type: UsageEvent["type"];
  totalCost: number;
  currency: string;
  pricingFound: boolean;
}

export interface UsageCostTotals {
  totalCost: number;
  currency: string;
  eventCount: number;
  missingPricingCount: number;
  byType: Partial<Record<UsageEvent["type"], number>>;
}

export class PriceUnavailableError extends Error {
  constructor(provider: string, model: string) {
    super(`No pricing available for ${provider}/${model}`);
    this.name = "PriceUnavailableError";
  }
}

function resolvePricing(
  usage: LlmUsage,
  pricing?: ModelPricing,
  fallback?: FallbackPricing,
): ModelPricing {
  if (pricing) {
    return pricing;
  }

  return {
    provider: usage.provider,
    model: usage.model,
    inputCostPerMillion: fallback?.inputCostPerMillion ?? 0,
    outputCostPerMillion: fallback?.outputCostPerMillion ?? 0,
    cacheReadCostPerMillion: fallback?.cacheReadCostPerMillion,
    cacheWriteCostPerMillion: fallback?.cacheWriteCostPerMillion,
    effectiveDate: "1970-01-01T00:00:00.000Z",
    currency: fallback?.currency ?? "USD",
  };
}

export class CostConversionService {
  private readonly pricingProvider: PricingProvider;
  private readonly missingPriceStrategy: MissingPriceStrategy;
  private readonly fallbackPricing: FallbackPricing;

  constructor(options: CostConversionOptions) {
    this.pricingProvider = options.pricingProvider;
    this.missingPriceStrategy = options.missingPriceStrategy ?? "zero";
    this.fallbackPricing = options.fallbackPricing ?? {};
  }

  async convertLlmUsage(usage: LlmUsage): Promise<LlmCostBreakdown> {
    const pricing = await this.pricingProvider.getPricing(usage.provider, usage.model);

    if (!pricing && this.missingPriceStrategy === "error") {
      throw new PriceUnavailableError(usage.provider, usage.model);
    }

    const resolved = resolvePricing(usage, pricing, this.fallbackPricing);

    const inputCost = (usage.inputTokens / 1_000_000) * resolved.inputCostPerMillion;
    const outputCost = (usage.outputTokens / 1_000_000) * resolved.outputCostPerMillion;
    const cacheReadCost =
      usage.cacheReadTokens && resolved.cacheReadCostPerMillion
        ? (usage.cacheReadTokens / 1_000_000) * resolved.cacheReadCostPerMillion
        : 0;
    const cacheWriteCost =
      usage.cacheWriteTokens && resolved.cacheWriteCostPerMillion
        ? (usage.cacheWriteTokens / 1_000_000) * resolved.cacheWriteCostPerMillion
        : 0;

    return {
      provider: usage.provider,
      model: usage.model,
      currency: resolved.currency,
      inputCost,
      outputCost,
      cacheReadCost,
      cacheWriteCost,
      totalCost: calculateLlmCost(usage, resolved),
      pricingFound: Boolean(pricing),
    };
  }

  async convertEvent(event: UsageEvent): Promise<UsageEventCost> {
    if (event.type !== "llm-call") {
      return {
        eventId: event.id,
        type: event.type,
        totalCost: 0,
        currency: this.fallbackPricing.currency ?? "USD",
        pricingFound: true,
      };
    }

    const breakdown = await this.convertLlmUsage(event.data as LlmUsage);

    return {
      eventId: event.id,
      type: event.type,
      totalCost: breakdown.totalCost,
      currency: breakdown.currency,
      pricingFound: breakdown.pricingFound,
    };
  }

  async convertEvents(events: UsageEvent[]): Promise<UsageCostTotals> {
    const byType: UsageCostTotals["byType"] = {};
    let totalCost = 0;
    let missingPricingCount = 0;

    for (const event of events) {
      const converted = await this.convertEvent(event);
      totalCost += converted.totalCost;
      byType[event.type] = (byType[event.type] ?? 0) + converted.totalCost;

      if (!converted.pricingFound) {
        missingPricingCount += 1;
      }
    }

    return {
      totalCost,
      currency: this.fallbackPricing.currency ?? "USD",
      eventCount: events.length,
      missingPricingCount,
      byType,
    };
  }

  async refreshPricing() {
    return this.pricingProvider.refresh();
  }

  async updatePricing(pricing: ModelPricing | ModelPricing[]) {
    return this.pricingProvider.update(pricing);
  }
}

export function createCostConversionService(options: CostConversionOptions): CostConversionService {
  return new CostConversionService(options);
}
