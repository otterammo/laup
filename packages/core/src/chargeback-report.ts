import {
  calculateLlmCost,
  type LlmUsage,
  type ModelPricing,
  type UsageAttribution,
  type UsageEvent,
} from "./cost-schema.js";
import type { PricingProvider } from "./pricing-provider.js";
import type { UsageQueryFilter, UsageStorage } from "./usage-storage.js";

export type ChargebackGroupType = "team" | "project" | "custom";

export interface ChargebackMappingRule {
  costCenter: string;
  groupType: ChargebackGroupType;
  groupId: string;
  groupName?: string;
  match: Partial<UsageAttribution>;
}

export interface ChargebackBillingPeriod {
  startTime: Date;
  endTime: Date;
}

export interface ChargebackReportRow {
  costCenter: string;
  groupType: ChargebackGroupType | "costCenter";
  groupId: string;
  groupName?: string;
  totalCost: number;
  totalTokens: number;
  eventCount: number;
}

export interface ChargebackReport {
  generatedAt: string;
  billingPeriod: {
    startTime: string;
    endTime: string;
    granularity: "month" | "custom";
  };
  rows: ChargebackReportRow[];
}

export interface ChargebackReportServiceConfig {
  usageStorage: UsageStorage;
  pricingProvider: PricingProvider;
  now?: () => Date;
}

export interface GenerateChargebackReportInput {
  billingPeriod?: ChargebackBillingPeriod;
  mappings?: ChargebackMappingRule[];
}

export interface ChargebackExportOptions {
  format: "json" | "csv";
  pretty?: boolean;
  includeHeaders?: boolean;
}

export class ChargebackReportService {
  private readonly now: () => Date;

  constructor(private readonly config: ChargebackReportServiceConfig) {
    this.now = config.now ?? (() => new Date());
  }

  async generate(input: GenerateChargebackReportInput = {}): Promise<ChargebackReport> {
    const resolvedPeriod = resolveBillingPeriod(input.billingPeriod, this.now());

    const events = await queryAllEvents(this.config.usageStorage, {
      startTime: resolvedPeriod.startTime,
      endTime: resolvedPeriod.endTime,
    });
    const pricingMap = new Map(
      (await this.config.pricingProvider.getAllPricing()).map((price) => [
        `${price.provider}/${price.model}`,
        price,
      ]),
    );

    const rows = aggregateChargebackRows(events, pricingMap, input.mappings ?? []);

    return {
      generatedAt: this.now().toISOString(),
      billingPeriod: {
        startTime: resolvedPeriod.startTime.toISOString(),
        endTime: resolvedPeriod.endTime.toISOString(),
        granularity: input.billingPeriod ? "custom" : "month",
      },
      rows,
    };
  }
}

export function createChargebackReportService(
  config: ChargebackReportServiceConfig,
): ChargebackReportService {
  return new ChargebackReportService(config);
}

export function exportChargebackReport(
  report: ChargebackReport,
  options: ChargebackExportOptions,
): string {
  if (options.format === "json") {
    return options.pretty ? JSON.stringify(report, null, 2) : JSON.stringify(report);
  }

  const headers = [
    "periodStart",
    "periodEnd",
    "costCenter",
    "groupType",
    "groupId",
    "groupName",
    "totalCost",
    "totalTokens",
    "eventCount",
  ];
  const lines: string[] = [];

  if (options.includeHeaders !== false) {
    lines.push(headers.join(","));
  }

  for (const row of report.rows) {
    const values = [
      report.billingPeriod.startTime,
      report.billingPeriod.endTime,
      row.costCenter,
      row.groupType,
      row.groupId,
      row.groupName ?? "",
      row.totalCost,
      row.totalTokens,
      row.eventCount,
    ].map(escapeCsvValue);
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

function resolveBillingPeriod(
  billingPeriod: ChargebackBillingPeriod | undefined,
  reference: Date,
): ChargebackBillingPeriod {
  if (billingPeriod) {
    return billingPeriod;
  }

  const startTime = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const endTime = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { startTime, endTime };
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getLlmCost(
  event: UsageEvent,
  pricingMap: Map<string, ModelPricing>,
): { cost: number; tokens: number } {
  if (event.type !== "llm-call") {
    return { cost: 0, tokens: 0 };
  }

  const data = event.data as LlmUsage;
  const modelPricing = pricingMap.get(`${data.provider}/${data.model}`);
  if (!modelPricing) {
    return {
      cost: 0,
      tokens: data.inputTokens + data.outputTokens,
    };
  }

  return {
    cost: calculateLlmCost(data, modelPricing),
    tokens: data.inputTokens + data.outputTokens,
  };
}

function aggregateChargebackRows(
  events: UsageEvent[],
  pricingMap: Map<string, ModelPricing>,
  mappings: ChargebackMappingRule[],
): ChargebackReportRow[] {
  const grouped = new Map<string, ChargebackReportRow>();

  for (const event of events) {
    const { cost, tokens } = getLlmCost(event, pricingMap);
    const mapping = mappings.find((rule) => matchesAttribution(event.attribution, rule.match));

    const costCenter = mapping?.costCenter ?? event.attribution.costCenter ?? "unmapped";
    const groupType = mapping?.groupType ?? "costCenter";
    const groupId = mapping?.groupId ?? costCenter;
    const groupName = mapping?.groupName;

    const key = `${costCenter}::${groupType}::${groupId}`;
    const existing =
      grouped.get(key) ??
      ({
        costCenter,
        groupType,
        groupId,
        ...(groupName ? { groupName } : {}),
        totalCost: 0,
        totalTokens: 0,
        eventCount: 0,
      } satisfies ChargebackReportRow);

    existing.totalCost += cost;
    existing.totalTokens += tokens;
    existing.eventCount += 1;

    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalCost - a.totalCost);
}

function matchesAttribution(
  attribution: UsageAttribution,
  matcher: Partial<UsageAttribution>,
): boolean {
  return Object.entries(matcher).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }

    return attribution[key as keyof UsageAttribution] === value;
  });
}

async function queryAllEvents(usageStorage: UsageStorage, filter: UsageQueryFilter) {
  const pageSize = 500;
  let offset = 0;
  const events: Awaited<ReturnType<UsageStorage["query"]>>["data"] = [];

  while (true) {
    const page = await usageStorage.query(filter, { limit: pageSize, offset });
    events.push(...page.data);

    if (!page.hasMore) {
      break;
    }

    offset += pageSize;
  }

  return events;
}
