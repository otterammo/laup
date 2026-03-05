import { z } from "zod";
import type { InfrastructureCostStorage } from "./cloud-billing.js";
import {
  type AutoModelRoutingPolicy,
  AutoModelRoutingPolicySchema,
  buildAutoModelRoutingRules,
  generateModelRoutingRecommendations,
  type ModelRoutingRecommendation,
} from "./cost-routing-recommendations.js";
import { aggregateUsage, type CostSummary } from "./cost-schema.js";
import type { PricingProvider } from "./pricing-provider.js";
import type { UsageStorage } from "./usage-storage.js";

export const CostDashboardWindowSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().positive(),
});

export type CostDashboardWindow = z.infer<typeof CostDashboardWindowSchema>;

export const CostDashboardHistoricalConfigSchema = z.object({
  bucket: z.enum(["hour", "day"]).default("hour"),
  points: z.number().int().positive().default(24),
});

export type CostDashboardHistoricalConfig = z.infer<typeof CostDashboardHistoricalConfigSchema>;

export const CostDashboardRoutingRecommendationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  minEvents: z.number().int().positive().default(5),
  maxRecommendations: z.number().int().positive().default(20),
  autoRouting: AutoModelRoutingPolicySchema.default({
    enabled: false,
    minimumConfidence: 0.75,
    minimumSavingsUsd: 0,
  }),
});

export type CostDashboardRoutingRecommendationConfig = z.infer<
  typeof CostDashboardRoutingRecommendationConfigSchema
>;

export interface CostDashboardConfig {
  usageStorage: UsageStorage;
  pricingProvider: PricingProvider;
  infrastructureCostStorage?: InfrastructureCostStorage;
  windows?: CostDashboardWindow[];
  historical?: Partial<CostDashboardHistoricalConfig>;
  routingRecommendations?: Partial<CostDashboardRoutingRecommendationConfig>;
  now?: () => Date;
}

export interface CostDashboardLineItems {
  application: number;
  infrastructure: number;
  total: number;
}

export interface CostDashboardHistoryPoint {
  bucketStart: string;
  bucketEnd: string;
  summary: CostSummary;
}

export interface CostDashboardSnapshot {
  generatedAt: string;
  realtime: {
    windowId: string;
    startTime: string;
    endTime: string;
    summary: CostSummary;
    lineItems: CostDashboardLineItems;
  };
  windows: Array<{
    id: string;
    durationMs: number;
    startTime: string;
    endTime: string;
    summary: CostSummary;
    lineItems: CostDashboardLineItems;
  }>;
  historical: {
    bucket: "hour" | "day";
    points: Array<CostDashboardHistoryPoint & { lineItems: CostDashboardLineItems }>;
  };
  routingRecommendations: {
    enabled: boolean;
    recommendations: ModelRoutingRecommendation[];
    autoRouting: {
      enabled: boolean;
      policy: AutoModelRoutingPolicy;
      rules: Array<{
        taskType: string;
        provider: string;
        fromModel: string;
        toModel: string;
        confidence: number;
        estimatedSavings: number;
      }>;
    };
  };
}

const DEFAULT_WINDOWS: CostDashboardWindow[] = [
  { id: "5m", durationMs: 5 * 60_000 },
  { id: "1h", durationMs: 60 * 60_000 },
  { id: "24h", durationMs: 24 * 60 * 60_000 },
];

export class CostDashboardService {
  private readonly now: () => Date;
  private readonly windows: CostDashboardWindow[];
  private readonly historical: CostDashboardHistoricalConfig;
  private readonly routingRecommendations: CostDashboardRoutingRecommendationConfig;

  constructor(private readonly config: CostDashboardConfig) {
    this.now = config.now ?? (() => new Date());
    this.windows = normalizeWindows(config.windows ?? DEFAULT_WINDOWS);
    this.historical = CostDashboardHistoricalConfigSchema.parse(config.historical ?? {});
    this.routingRecommendations = CostDashboardRoutingRecommendationConfigSchema.parse(
      config.routingRecommendations ?? {},
    );
  }

  async snapshot(): Promise<CostDashboardSnapshot> {
    const endTime = this.now();
    const pricingMap = new Map(
      (await this.config.pricingProvider.getAllPricing()).map((price) => [
        `${price.provider}/${price.model}`,
        price,
      ]),
    );

    const maxWindowDuration = Math.max(...this.windows.map((window) => window.durationMs));
    const historyDurationMs = this.historical.points * bucketDurationMs(this.historical.bucket);
    const maxDurationMs = Math.max(maxWindowDuration, historyDurationMs);
    const earliestStart = new Date(endTime.getTime() - maxDurationMs);

    const events = await queryAllEvents(this.config.usageStorage, earliestStart, endTime);
    const infrastructureCosts = this.config.infrastructureCostStorage
      ? await this.config.infrastructureCostStorage.query({ startTime: earliestStart, endTime })
      : [];

    const windows = this.windows.map((window) => {
      const startTime = new Date(endTime.getTime() - window.durationMs);
      const summary = summarizeRange(events, pricingMap, startTime, endTime);
      const infrastructure = summarizeInfrastructureRange(infrastructureCosts, startTime, endTime);
      return {
        id: window.id,
        durationMs: window.durationMs,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        summary,
        lineItems: {
          application: summary.totalCost,
          infrastructure,
          total: summary.totalCost + infrastructure,
        },
      };
    });

    const realtimeWindow = windows[0];
    if (!realtimeWindow) {
      throw new Error("Cost dashboard requires at least one window");
    }

    const historicalPoints = buildHistory(
      events,
      pricingMap,
      infrastructureCosts,
      endTime,
      this.historical,
    );

    const recommendations = this.routingRecommendations.enabled
      ? generateModelRoutingRecommendations(events, pricingMap, {
          minEvents: this.routingRecommendations.minEvents,
          maxRecommendations: this.routingRecommendations.maxRecommendations,
        })
      : [];

    const autoRoutingRules = buildAutoModelRoutingRules(
      recommendations,
      this.routingRecommendations.autoRouting,
    );

    return {
      generatedAt: endTime.toISOString(),
      realtime: {
        windowId: realtimeWindow.id,
        startTime: realtimeWindow.startTime,
        endTime: realtimeWindow.endTime,
        summary: realtimeWindow.summary,
        lineItems: realtimeWindow.lineItems,
      },
      windows,
      historical: {
        bucket: this.historical.bucket,
        points: historicalPoints,
      },
      routingRecommendations: {
        enabled: this.routingRecommendations.enabled,
        recommendations,
        autoRouting: {
          enabled: this.routingRecommendations.autoRouting.enabled,
          policy: this.routingRecommendations.autoRouting,
          rules: autoRoutingRules,
        },
      },
    };
  }
}

export function createCostDashboardService(config: CostDashboardConfig): CostDashboardService {
  return new CostDashboardService(config);
}

async function queryAllEvents(usageStorage: UsageStorage, startTime: Date, endTime: Date) {
  const pageSize = 500;
  let offset = 0;
  const events: Awaited<ReturnType<UsageStorage["query"]>>["data"] = [];

  while (true) {
    const page = await usageStorage.query({ startTime, endTime }, { limit: pageSize, offset });
    events.push(...page.data);

    if (!page.hasMore) {
      break;
    }

    offset += pageSize;
  }

  return events;
}

function summarizeRange(
  events: Awaited<ReturnType<UsageStorage["query"]>>["data"],
  pricingMap: Parameters<typeof aggregateUsage>[1],
  startTime: Date,
  endTime: Date,
): CostSummary {
  const filtered = events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return timestamp >= startTime.getTime() && timestamp < endTime.getTime();
  });

  return aggregateUsage(filtered, pricingMap, startTime.toISOString(), endTime.toISOString());
}

function summarizeInfrastructureRange(
  records: Array<{ amount: number; startTime: string; endTime: string }>,
  startTime: Date,
  endTime: Date,
): number {
  const start = startTime.getTime();
  const end = endTime.getTime();

  return records.reduce((total, record) => {
    const recordStart = Date.parse(record.startTime);
    const recordEnd = Date.parse(record.endTime);
    if (recordEnd > start && recordStart < end) {
      return total + record.amount;
    }

    return total;
  }, 0);
}

function buildHistory(
  events: Awaited<ReturnType<UsageStorage["query"]>>["data"],
  pricingMap: Parameters<typeof aggregateUsage>[1],
  infrastructureCosts: Array<{ amount: number; startTime: string; endTime: string }>,
  endTime: Date,
  historical: CostDashboardHistoricalConfig,
): Array<CostDashboardHistoryPoint & { lineItems: CostDashboardLineItems }> {
  const durationMs = bucketDurationMs(historical.bucket);
  const points: Array<CostDashboardHistoryPoint & { lineItems: CostDashboardLineItems }> = [];

  for (let index = historical.points - 1; index >= 0; index -= 1) {
    const bucketEnd = new Date(endTime.getTime() - index * durationMs);
    const bucketStart = new Date(bucketEnd.getTime() - durationMs);

    const summary = summarizeRange(events, pricingMap, bucketStart, bucketEnd);
    const infrastructure = summarizeInfrastructureRange(
      infrastructureCosts,
      bucketStart,
      bucketEnd,
    );

    points.push({
      bucketStart: bucketStart.toISOString(),
      bucketEnd: bucketEnd.toISOString(),
      summary,
      lineItems: {
        application: summary.totalCost,
        infrastructure,
        total: summary.totalCost + infrastructure,
      },
    });
  }

  return points;
}

function bucketDurationMs(bucket: "hour" | "day"): number {
  return bucket === "day" ? 24 * 60 * 60_000 : 60 * 60_000;
}

function normalizeWindows(windows: CostDashboardWindow[]): CostDashboardWindow[] {
  const unique = new Map<string, CostDashboardWindow>();

  for (const window of windows) {
    const parsed = CostDashboardWindowSchema.parse(window);
    if (!unique.has(parsed.id)) {
      unique.set(parsed.id, parsed);
    }
  }

  return Array.from(unique.values()).sort(
    (a, b) => a.durationMs - b.durationMs || a.id.localeCompare(b.id),
  );
}
