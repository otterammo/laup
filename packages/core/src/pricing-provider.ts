import type { ModelPricing } from "./cost-schema.js";

export interface PricingRefreshResult {
  updated: number;
  timestamp: string;
}

export interface PricingProvider {
  getPricing(provider: string, model: string): Promise<ModelPricing | undefined>;
  getAllPricing(): Promise<ModelPricing[]>;
  refresh(): Promise<PricingRefreshResult>;
  update(pricing: ModelPricing | ModelPricing[]): Promise<void>;
}

export interface InMemoryPricingProviderOptions {
  initialPricing?: ModelPricing[];
  fetchLatest?: () => Promise<ModelPricing[]>;
  now?: () => Date;
}

function pricingKey(provider: string, model: string): string {
  return `${provider}/${model}`;
}

export class InMemoryPricingProvider implements PricingProvider {
  private readonly pricing = new Map<string, ModelPricing>();
  private readonly fetchLatest: (() => Promise<ModelPricing[]>) | undefined;
  private readonly now: () => Date;

  constructor(options: InMemoryPricingProviderOptions = {}) {
    this.fetchLatest = options.fetchLatest;
    this.now = options.now ?? (() => new Date());

    for (const price of options.initialPricing ?? []) {
      this.pricing.set(pricingKey(price.provider, price.model), price);
    }
  }

  async getPricing(provider: string, model: string): Promise<ModelPricing | undefined> {
    return this.pricing.get(pricingKey(provider, model));
  }

  async getAllPricing(): Promise<ModelPricing[]> {
    return Array.from(this.pricing.values());
  }

  async refresh(): Promise<PricingRefreshResult> {
    if (!this.fetchLatest) {
      return { updated: 0, timestamp: this.now().toISOString() };
    }

    const latest = await this.fetchLatest();
    await this.update(latest);

    return { updated: latest.length, timestamp: this.now().toISOString() };
  }

  async update(pricing: ModelPricing | ModelPricing[]): Promise<void> {
    const updates = Array.isArray(pricing) ? pricing : [pricing];

    for (const price of updates) {
      this.pricing.set(pricingKey(price.provider, price.model), price);
    }
  }
}

export function createPricingProvider(
  options: InMemoryPricingProviderOptions = {},
): PricingProvider {
  return new InMemoryPricingProvider(options);
}
