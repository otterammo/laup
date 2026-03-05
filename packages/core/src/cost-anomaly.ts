import { z } from "zod";
import type { AuditSeverity, AuditStorage } from "./audit-storage.js";
import type { UsageStorage } from "./usage-storage.js";

export const CostAnomalyDimensionSchema = z.enum(["developerId", "projectId"]);
export type CostAnomalyDimension = z.infer<typeof CostAnomalyDimensionSchema>;

export const CostAnomalyChannelSchema = z.enum(["email", "slack", "webhook"]);
export type CostAnomalyChannel = z.infer<typeof CostAnomalyChannelSchema>;

export const CostAnomalySchema = z.object({
  id: z.string(),
  detectedAt: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  dimension: CostAnomalyDimensionSchema,
  subject: z.string(),
  currentTokens: z.number().int().nonnegative(),
  baselineTokens: z.number().nonnegative(),
  ratio: z.number().nonnegative(),
  thresholdMultiplier: z.number().positive(),
  severity: z.enum(["warning", "critical"]),
});

export type CostAnomaly = z.infer<typeof CostAnomalySchema>;

export const CostAnomalyDetectionReportSchema = z.object({
  generatedAt: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  baselineStart: z.string(),
  baselineEnd: z.string(),
  thresholdMultiplier: z.number().positive(),
  detectionWindowMs: z.number().int().positive(),
  baselineWindowCount: z.number().int().positive(),
  anomalies: z.array(CostAnomalySchema),
});

export type CostAnomalyDetectionReport = z.infer<typeof CostAnomalyDetectionReportSchema>;

export interface CostAnomalyDetectorConfig {
  usageStorage: UsageStorage;
  auditStorage: AuditStorage;
  detectionWindowMs?: number;
  baselineWindowCount?: number;
  thresholdMultiplier?: number;
  dimensions?: CostAnomalyDimension[];
  channels?: CostAnomalyChannel[];
  notificationSender?: (channel: CostAnomalyChannel, anomaly: CostAnomaly) => Promise<void> | void;
  now?: () => Date;
}

const DEFAULT_DETECTION_WINDOW_MS = 60 * 60_000;
const DEFAULT_BASELINE_WINDOW_COUNT = 24;
const DEFAULT_THRESHOLD_MULTIPLIER = 5;
const DEFAULT_DIMENSIONS: CostAnomalyDimension[] = ["developerId", "projectId"];
const DEFAULT_CHANNELS: CostAnomalyChannel[] = ["email"];

export class CostAnomalyDetector {
  private readonly now: () => Date;
  private readonly detectionWindowMs: number;
  private readonly baselineWindowCount: number;
  private readonly thresholdMultiplier: number;
  private readonly dimensions: CostAnomalyDimension[];
  private readonly channels: CostAnomalyChannel[];

  constructor(private readonly config: CostAnomalyDetectorConfig) {
    this.now = config.now ?? (() => new Date());
    this.detectionWindowMs = positiveInt(config.detectionWindowMs, DEFAULT_DETECTION_WINDOW_MS);
    this.baselineWindowCount = positiveInt(
      config.baselineWindowCount,
      DEFAULT_BASELINE_WINDOW_COUNT,
    );
    this.thresholdMultiplier = config.thresholdMultiplier ?? DEFAULT_THRESHOLD_MULTIPLIER;
    if (this.thresholdMultiplier <= 0) {
      throw new Error("thresholdMultiplier must be positive");
    }

    this.dimensions = uniqueDimensions(config.dimensions ?? DEFAULT_DIMENSIONS);
    this.channels = uniqueChannels(config.channels ?? DEFAULT_CHANNELS);
  }

  async detect(): Promise<CostAnomalyDetectionReport> {
    const endTime = this.now();
    const windowStart = new Date(endTime.getTime() - this.detectionWindowMs);
    const baselineStart = new Date(
      windowStart.getTime() - this.detectionWindowMs * this.baselineWindowCount,
    );

    const events = await this.loadEvents(baselineStart, endTime);
    const anomalies = this.findAnomalies(events, baselineStart, windowStart, endTime);

    for (const anomaly of anomalies) {
      await this.config.auditStorage.append({
        category: "data",
        action: "cost.anomaly.detected",
        actor: "system",
        targetId: `${anomaly.dimension}:${anomaly.subject}`,
        targetType: "cost-anomaly",
        severity: anomaly.severity as AuditSeverity,
        metadata: {
          ...anomaly,
          channels: this.channels,
        },
      });

      if (this.config.notificationSender) {
        for (const channel of this.channels) {
          await this.config.notificationSender(channel, anomaly);
        }
      }
    }

    return {
      generatedAt: endTime.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: endTime.toISOString(),
      baselineStart: baselineStart.toISOString(),
      baselineEnd: windowStart.toISOString(),
      thresholdMultiplier: this.thresholdMultiplier,
      detectionWindowMs: this.detectionWindowMs,
      baselineWindowCount: this.baselineWindowCount,
      anomalies,
    };
  }

  private async loadEvents(startTime: Date, endTime: Date) {
    const pageSize = 500;
    let offset = 0;
    const events: Awaited<ReturnType<UsageStorage["query"]>>["data"] = [];

    while (true) {
      const page = await this.config.usageStorage.query(
        { startTime, endTime },
        { limit: pageSize, offset },
      );
      events.push(...page.data);

      if (!page.hasMore) break;
      offset += pageSize;
    }

    return events;
  }

  private findAnomalies(
    events: Awaited<ReturnType<UsageStorage["query"]>>["data"],
    baselineStart: Date,
    windowStart: Date,
    windowEnd: Date,
  ): CostAnomaly[] {
    const anomalies: CostAnomaly[] = [];

    for (const dimension of this.dimensions) {
      const subjects = collectSubjects(events, dimension);

      for (const subject of subjects) {
        const currentTokens = tokenTotalForRange(
          events,
          dimension,
          subject,
          windowStart,
          windowEnd,
        );
        const baselineTotal = tokenTotalForRange(
          events,
          dimension,
          subject,
          baselineStart,
          windowStart,
        );
        const baselineTokens = baselineTotal / this.baselineWindowCount;

        if (baselineTokens <= 0) {
          continue;
        }

        const ratio = currentTokens / baselineTokens;
        if (ratio < this.thresholdMultiplier) {
          continue;
        }

        anomalies.push({
          id: `${dimension}:${subject}:${windowEnd.toISOString()}`,
          detectedAt: windowEnd.toISOString(),
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          dimension,
          subject,
          currentTokens,
          baselineTokens,
          ratio,
          thresholdMultiplier: this.thresholdMultiplier,
          severity: ratio >= this.thresholdMultiplier * 2 ? "critical" : "warning",
        });
      }
    }

    return anomalies.sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function createCostAnomalyDetector(config: CostAnomalyDetectorConfig): CostAnomalyDetector {
  return new CostAnomalyDetector(config);
}

function positiveInt(value: number | undefined, fallback: number): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error("Expected positive integer configuration value");
  }
  return normalized;
}

function uniqueDimensions(dimensions: CostAnomalyDimension[]): CostAnomalyDimension[] {
  return Array.from(
    new Set(dimensions.map((dimension) => CostAnomalyDimensionSchema.parse(dimension))),
  );
}

function uniqueChannels(channels: CostAnomalyChannel[]): CostAnomalyChannel[] {
  return Array.from(new Set(channels.map((channel) => CostAnomalyChannelSchema.parse(channel))));
}

function collectSubjects(
  events: Awaited<ReturnType<UsageStorage["query"]>>["data"],
  dimension: CostAnomalyDimension,
): string[] {
  const values = new Set<string>();
  for (const event of events) {
    const value = event.attribution[dimension] ?? "unknown";
    values.add(value);
  }
  return Array.from(values.values());
}

function tokenTotalForRange(
  events: Awaited<ReturnType<UsageStorage["query"]>>["data"],
  dimension: CostAnomalyDimension,
  subject: string,
  start: Date,
  end: Date,
): number {
  let total = 0;

  for (const event of events) {
    const timestamp = Date.parse(event.timestamp);
    if (timestamp < start.getTime() || timestamp >= end.getTime()) {
      continue;
    }

    const eventSubject = event.attribution[dimension] ?? "unknown";
    if (eventSubject !== subject) {
      continue;
    }

    if (event.type !== "llm-call") {
      continue;
    }

    const usage = event.data as { inputTokens: number; outputTokens: number };
    total += usage.inputTokens + usage.outputTokens;
  }

  return total;
}
