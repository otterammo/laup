import { z } from "zod";

/**
 * Usage event types (COST-001).
 */
export const UsageEventTypeSchema = z.enum([
  "llm-call", // LLM API call
  "mcp-invocation", // MCP tool invocation
  "skill-invocation", // Skill invocation
  "memory-operation", // Memory read/write
]);

export type UsageEventType = z.infer<typeof UsageEventTypeSchema>;

/**
 * LLM API call usage data (COST-001).
 */
export const LlmUsageSchema = z.object({
  /** LLM provider (e.g., "anthropic", "openai") */
  provider: z.string(),

  /** Model ID */
  model: z.string(),

  /** Input token count */
  inputTokens: z.number().int().nonnegative(),

  /** Output token count */
  outputTokens: z.number().int().nonnegative(),

  /** Cache read tokens (if applicable) */
  cacheReadTokens: z.number().int().nonnegative().optional(),

  /** Cache write tokens (if applicable) */
  cacheWriteTokens: z.number().int().nonnegative().optional(),

  /** Request duration in milliseconds */
  durationMs: z.number().nonnegative().optional(),

  /** Whether request was successful */
  success: z.boolean(),

  /** Error code if failed */
  errorCode: z.string().optional(),
});

export type LlmUsage = z.infer<typeof LlmUsageSchema>;

/**
 * MCP tool invocation usage data (COST-001).
 */
export const McpInvocationUsageSchema = z.object({
  /** MCP server ID */
  serverId: z.string(),

  /** Tool name */
  toolName: z.string(),

  /** Invocation duration in milliseconds */
  durationMs: z.number().nonnegative().optional(),

  /** Whether invocation was successful */
  success: z.boolean(),

  /** Error message if failed */
  error: z.string().optional(),
});

export type McpInvocationUsage = z.infer<typeof McpInvocationUsageSchema>;

/**
 * Skill invocation usage data (COST-001).
 */
export const SkillInvocationUsageSchema = z.object({
  /** Skill ID (namespace/name) */
  skillId: z.string(),

  /** Skill version */
  version: z.string().optional(),

  /** Invocation duration in milliseconds */
  durationMs: z.number().nonnegative().optional(),

  /** Whether invocation was successful */
  success: z.boolean(),

  /** Error message if failed */
  error: z.string().optional(),
});

export type SkillInvocationUsage = z.infer<typeof SkillInvocationUsageSchema>;

/**
 * Memory operation usage data (COST-001).
 */
export const MemoryOperationUsageSchema = z.object({
  /** Operation type */
  operation: z.enum(["read", "write", "search", "delete"]),

  /** Memory scope (e.g., "session", "project", "user") */
  scope: z.string(),

  /** Number of items affected */
  itemCount: z.number().int().nonnegative().optional(),

  /** Size in bytes (if applicable) */
  sizeBytes: z.number().int().nonnegative().optional(),

  /** Operation duration in milliseconds */
  durationMs: z.number().nonnegative().optional(),

  /** Whether operation was successful */
  success: z.boolean(),
});

export type MemoryOperationUsage = z.infer<typeof MemoryOperationUsageSchema>;

/**
 * Attribution dimensions (COST-002).
 */
export const UsageAttributionSchema = z.object({
  /** Developer/user ID */
  userId: z.string().optional(),

  /** Preferred attribution actor identifier */
  developerId: z.string().optional(),

  /** Team ID */
  teamId: z.string().optional(),

  /** Project ID */
  projectId: z.string().optional(),

  /** Organization ID */
  orgId: z.string().optional(),

  /** Skill ID (for skill attribution) */
  skillId: z.string().optional(),

  /** Session ID */
  sessionId: z.string().optional(),

  /** Emitting adapter identifier */
  adapterId: z.string().optional(),

  /** Emitting adapter/tool category */
  toolCategory: z.string().optional(),

  /** Business unit / cost center (COST-011) */
  costCenter: z.string().optional(),
});

export type UsageAttribution = z.infer<typeof UsageAttributionSchema>;

export const AttributionDimensionSchema = z.enum([
  "developerId",
  "userId",
  "teamId",
  "projectId",
  "orgId",
  "skillId",
  "sessionId",
  "adapterId",
  "toolCategory",
  "costCenter",
]);

export type AttributionDimension = z.infer<typeof AttributionDimensionSchema>;

export interface AttributionAggregate {
  dimension: AttributionDimension;
  value: string;
  totalCost: number;
  eventCount: number;
}

export interface SkillCostAttribution {
  skillId: string;
  totalTokens: number;
  totalCost: number;
  eventCount: number;
}

export interface AttributionCombinationAggregate {
  dimensions: Record<AttributionDimension, string>;
  totalCost: number;
  eventCount: number;
}

/**
 * Usage event record (COST-001).
 */
export const UsageEventSchema = z.object({
  /** Unique event ID */
  id: z.string(),

  /** Event type */
  type: UsageEventTypeSchema,

  /** ISO 8601 timestamp */
  timestamp: z.string(),

  /** Attribution dimensions */
  attribution: UsageAttributionSchema,

  /** Type-specific usage data */
  data: z.union([
    LlmUsageSchema,
    McpInvocationUsageSchema,
    SkillInvocationUsageSchema,
    MemoryOperationUsageSchema,
  ]),
});

export type UsageEvent = z.infer<typeof UsageEventSchema>;

/**
 * Model pricing configuration (COST-003).
 */
export const ModelPricingSchema = z.object({
  /** Provider ID */
  provider: z.string(),

  /** Model ID */
  model: z.string(),

  /** Cost per 1M input tokens (USD) */
  inputCostPerMillion: z.number().nonnegative(),

  /** Cost per 1M output tokens (USD) */
  outputCostPerMillion: z.number().nonnegative(),

  /** Cost per 1M cache read tokens (USD) */
  cacheReadCostPerMillion: z.number().nonnegative().optional(),

  /** Cost per 1M cache write tokens (USD) */
  cacheWriteCostPerMillion: z.number().nonnegative().optional(),

  /** Effective date */
  effectiveDate: z.string(),

  /** Currency code */
  currency: z.string().default("USD"),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

/**
 * Budget alert configuration (COST-004).
 */
export const BudgetAlertSchema = z
  .object({
    /** Alert ID */
    id: z.string(),

    /** Alert name */
    name: z.string(),

    /** Optional absolute threshold amount (USD) */
    threshold: z.number().positive().optional(),

    /** Configured budget amount for percentage-based alerts (USD) */
    budget: z.number().positive().optional(),

    /** Alert trigger percentages of budget (e.g., 75, 90, 100) */
    percentages: z.array(z.number().gt(0).lte(100)).min(1).optional(),

    /** Whether projected spend should be used for trigger evaluation */
    projected: z.boolean().optional(),

    /** Time period */
    period: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]),

    /** Optional attribution target (COST-004): developer/team/project */
    attributionDimension: z.enum(["developerId", "teamId", "projectId"]).optional(),

    /** Attribution value for the configured dimension */
    attributionValue: z.string().optional(),

    /** Attribution filter */
    filter: UsageAttributionSchema.optional(),

    /** Alert recipients */
    recipients: z.array(z.string()),

    /** Whether alert is enabled */
    enabled: z.boolean().default(true),

    /** Notification channels (PERM-017) */
    channels: z.array(z.enum(["email", "slack", "webhook"])).default(["email"]),
  })
  .superRefine((value, ctx) => {
    if (value.attributionDimension && !value.attributionValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attributionValue is required when attributionDimension is configured",
        path: ["attributionValue"],
      });
    }

    if (value.attributionValue && !value.attributionDimension) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attributionDimension is required when attributionValue is configured",
        path: ["attributionDimension"],
      });
    }

    const hasAbsoluteThreshold = value.threshold !== undefined;
    const hasPercentageThreshold = value.budget !== undefined;

    if (!hasAbsoluteThreshold && !hasPercentageThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either threshold or budget must be configured",
        path: ["threshold"],
      });
    }
  });

export type BudgetAlert = z.infer<typeof BudgetAlertSchema>;

/**
 * Cost cap policy (COST-005).
 */
export const CostCapSchema = z.object({
  /** Cap ID */
  id: z.string(),

  /** Cap name */
  name: z.string(),

  /** Maximum amount (USD) */
  maxAmount: z.number().positive(),

  /** Time period */
  period: z.enum(["daily", "weekly", "monthly"]),

  /** Attribution scope */
  scope: UsageAttributionSchema,

  /** Action when cap is reached */
  action: z.enum(["warn", "throttle", "block"]),

  /** Whether cap is enabled */
  enabled: z.boolean().default(true),
});

export type CostCap = z.infer<typeof CostCapSchema>;

export interface CostCapEvaluation {
  applies: boolean;
  exceeded: boolean;
  action: CostCap["action"] | null;
  shouldEnforce: boolean;
}

/**
 * Cost summary for a time period (COST-006).
 */
export const CostSummarySchema = z.object({
  /** Start of period */
  periodStart: z.string(),

  /** End of period */
  periodEnd: z.string(),

  /** Total cost (USD) */
  totalCost: z.number().nonnegative(),

  /** Cost breakdown by type */
  byType: z.record(UsageEventTypeSchema, z.number().nonnegative()),

  /** Cost breakdown by provider */
  byProvider: z.record(z.string(), z.number().nonnegative()).optional(),

  /** Cost breakdown by model */
  byModel: z.record(z.string(), z.number().nonnegative()).optional(),

  /** Cost breakdown by skill */
  bySkill: z.record(z.string(), z.number().nonnegative()).optional(),

  /** Token counts */
  tokenCounts: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative().optional(),
      cacheWrite: z.number().int().nonnegative().optional(),
    })
    .optional(),

  /** Currency code */
  currency: z.string().default("USD"),
});

export type CostSummary = z.infer<typeof CostSummarySchema>;

/**
 * Cost summary export format (COST-007).
 */
export type CostExportFormat = "json" | "csv";

export interface CostExportOptions {
  format: CostExportFormat;
  pretty?: boolean;
  includeHeaders?: boolean;
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCostExportRows(summary: CostSummary): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [
    {
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      currency: summary.currency,
      dimension: "total",
      key: "totalCost",
      cost: summary.totalCost,
    },
  ];

  const pushBreakdown = (dimension: string, breakdown?: Record<string, number>) => {
    if (!breakdown) return;
    for (const [key, cost] of Object.entries(breakdown)) {
      rows.push({
        periodStart: summary.periodStart,
        periodEnd: summary.periodEnd,
        currency: summary.currency,
        dimension,
        key,
        cost,
      });
    }
  };

  pushBreakdown("byType", summary.byType);
  pushBreakdown("byProvider", summary.byProvider);
  pushBreakdown("byModel", summary.byModel);
  pushBreakdown("bySkill", summary.bySkill);

  return rows;
}

/**
 * Export a cost summary as JSON or CSV (COST-007).
 */
export function exportCostSummary(summary: CostSummary, options: CostExportOptions): string {
  const rows = toCostExportRows(summary);

  if (options.format === "json") {
    return options.pretty ? JSON.stringify(rows, null, 2) : JSON.stringify(rows);
  }

  const fields = ["periodStart", "periodEnd", "currency", "dimension", "key", "cost"];
  const lines: string[] = [];

  if (options.includeHeaders !== false) {
    lines.push(fields.join(","));
  }

  for (const row of rows) {
    lines.push(fields.map((field) => escapeCsvValue(row[field])).join(","));
  }

  return lines.join("\n");
}

/**
 * Calculate cost for an LLM usage event.
 */
export function calculateLlmCost(usage: LlmUsage, pricing: ModelPricing): number {
  let cost = 0;

  // Input tokens
  cost += (usage.inputTokens / 1_000_000) * pricing.inputCostPerMillion;

  // Output tokens
  cost += (usage.outputTokens / 1_000_000) * pricing.outputCostPerMillion;

  // Cache read tokens
  if (usage.cacheReadTokens && pricing.cacheReadCostPerMillion) {
    cost += (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadCostPerMillion;
  }

  // Cache write tokens
  if (usage.cacheWriteTokens && pricing.cacheWriteCostPerMillion) {
    cost += (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWriteCostPerMillion;
  }

  return cost;
}

/**
 * Check whether an event attribution is within a cap scope.
 */
export function matchesCostCapScope(
  scope: UsageAttribution,
  attribution: UsageAttribution,
): boolean {
  return Object.entries(scope).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }

    return attribution[key as keyof UsageAttribution] === value;
  });
}

/**
 * Evaluate a cost cap against current spend and attribution context.
 */
export function evaluateCostCap(
  currentCost: number,
  cap: CostCap,
  attribution?: UsageAttribution,
): CostCapEvaluation {
  if (!cap.enabled) {
    return {
      applies: false,
      exceeded: false,
      action: null,
      shouldEnforce: false,
    };
  }

  const applies = attribution ? matchesCostCapScope(cap.scope, attribution) : true;
  const exceeded = applies && currentCost >= cap.maxAmount;

  return {
    applies,
    exceeded,
    action: exceeded ? cap.action : null,
    shouldEnforce: exceeded && cap.action !== "warn",
  };
}

/**
 * Check if a cost cap is exceeded.
 */
export function isCostCapExceeded(
  currentCost: number,
  cap: CostCap,
  attribution?: UsageAttribution,
): boolean {
  return evaluateCostCap(currentCost, cap, attribution).exceeded;
}

/**
 * Project end-of-period cost from current spend and elapsed period time.
 */
export function projectPeriodCost(
  currentCost: number,
  elapsedMs: number,
  periodMs: number,
): number {
  if (elapsedMs <= 0 || periodMs <= 0) return currentCost;
  return (currentCost / elapsedMs) * periodMs;
}

/**
 * Check if a budget alert should fire.
 */
export function shouldFireAlert(
  currentCost: number,
  alert: BudgetAlert,
  options?: { elapsedMs?: number; periodMs?: number },
): boolean {
  if (!alert.enabled) return false;

  const evaluationCost =
    alert.projected && options?.elapsedMs && options?.periodMs
      ? projectPeriodCost(currentCost, options.elapsedMs, options.periodMs)
      : currentCost;

  if (alert.threshold !== undefined && evaluationCost >= alert.threshold) {
    return true;
  }

  if (alert.budget !== undefined) {
    const percentages = alert.percentages?.length ? alert.percentages : [100];
    return percentages.some((percentage) => evaluationCost >= alert.budget! * (percentage / 100));
  }

  return false;
}

/**
 * Aggregate usage events into a cost summary.
 */
export function getAttributionValue(
  attribution: UsageAttribution,
  dimension: AttributionDimension,
): string {
  if (dimension === "developerId") {
    return attribution.developerId ?? attribution.userId ?? "unknown";
  }

  if (dimension === "userId") {
    return attribution.userId ?? attribution.developerId ?? "unknown";
  }

  return String(attribution[dimension] ?? "unknown");
}

function getEventCost(event: UsageEvent, pricing: Map<string, ModelPricing>): number {
  if (event.type !== "llm-call") {
    return 0;
  }

  const data = event.data as LlmUsage;
  const modelPricing = pricing.get(`${data.provider}/${data.model}`);
  if (!modelPricing) {
    return 0;
  }

  return calculateLlmCost(data, modelPricing);
}

function getEventSkillId(event: UsageEvent): string {
  return (
    event.attribution.skillId ??
    (event.type === "skill-invocation" ? (event.data as { skillId: string }).skillId : undefined) ??
    "unknown"
  );
}

function getEventTokenCount(event: UsageEvent): number {
  if (event.type !== "llm-call") {
    return 0;
  }

  const data = event.data as LlmUsage;
  return data.inputTokens + data.outputTokens;
}

export function aggregateUsageByAttribution(
  events: UsageEvent[],
  dimension: AttributionDimension,
  pricing: Map<string, ModelPricing>,
): AttributionAggregate[] {
  const grouped = new Map<string, AttributionAggregate>();

  for (const event of events) {
    const value = getAttributionValue(event.attribution, dimension);
    const existing = grouped.get(value) ?? { dimension, value, totalCost: 0, eventCount: 0 };

    existing.totalCost += getEventCost(event, pricing);
    existing.eventCount += 1;
    grouped.set(value, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalCost - a.totalCost);
}

export function aggregateUsageByAttributions(
  events: UsageEvent[],
  dimensions: AttributionDimension[],
  pricing: Map<string, ModelPricing>,
): AttributionCombinationAggregate[] {
  const grouped = new Map<string, AttributionCombinationAggregate>();

  for (const event of events) {
    const dimensionValues = Object.fromEntries(
      dimensions.map((dimension) => [dimension, getAttributionValue(event.attribution, dimension)]),
    ) as Record<AttributionDimension, string>;

    const key = dimensions.map((dimension) => dimensionValues[dimension]).join("::");
    const existing = grouped.get(key) ?? {
      dimensions: dimensionValues,
      totalCost: 0,
      eventCount: 0,
    };

    existing.totalCost += getEventCost(event, pricing);
    existing.eventCount += 1;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalCost - a.totalCost);
}

export function aggregateUsageByDeveloper(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
): AttributionAggregate[] {
  return aggregateUsageByAttribution(events, "developerId", pricing);
}

export function aggregateUsageByTeam(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
): AttributionAggregate[] {
  return aggregateUsageByAttribution(events, "teamId", pricing);
}

export function aggregateUsageByProject(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
): AttributionAggregate[] {
  return aggregateUsageByAttribution(events, "projectId", pricing);
}

export function aggregateUsageBySkill(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
): AttributionAggregate[] {
  return aggregateUsageByAttribution(events, "skillId", pricing);
}

export function aggregateSkillCostAttribution(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
): SkillCostAttribution[] {
  const grouped = new Map<string, SkillCostAttribution>();

  for (const event of events) {
    const skillId = getEventSkillId(event);
    const existing = grouped.get(skillId) ?? {
      skillId,
      totalTokens: 0,
      totalCost: 0,
      eventCount: 0,
    };

    existing.totalTokens += getEventTokenCount(event);
    existing.totalCost += getEventCost(event, pricing);
    existing.eventCount += 1;

    grouped.set(skillId, existing);
  }

  return Array.from(grouped.values()).sort(
    (a, b) =>
      b.totalCost - a.totalCost ||
      b.totalTokens - a.totalTokens ||
      a.skillId.localeCompare(b.skillId),
  );
}

export function aggregateUsage(
  events: UsageEvent[],
  pricing: Map<string, ModelPricing>,
  periodStart: string,
  periodEnd: string,
): CostSummary {
  const byType: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const bySkill: Record<string, number> = {};
  let totalCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const event of events) {
    let eventCost = 0;

    if (event.type === "llm-call") {
      const data = event.data as LlmUsage;
      const key = `${data.provider}/${data.model}`;
      const modelPricing = pricing.get(key);

      if (modelPricing) {
        eventCost = calculateLlmCost(data, modelPricing);
        byProvider[data.provider] = (byProvider[data.provider] ?? 0) + eventCost;
        byModel[key] = (byModel[key] ?? 0) + eventCost;
      }

      inputTokens += data.inputTokens;
      outputTokens += data.outputTokens;
    }

    const skillId = getEventSkillId(event);
    bySkill[skillId] = (bySkill[skillId] ?? 0) + eventCost;

    byType[event.type] = (byType[event.type] ?? 0) + eventCost;
    totalCost += eventCost;
  }

  return {
    periodStart,
    periodEnd,
    totalCost,
    byType: byType as Record<UsageEventType, number>,
    byProvider,
    byModel,
    bySkill,
    tokenCounts: { input: inputTokens, output: outputTokens },
    currency: "USD",
  };
}
