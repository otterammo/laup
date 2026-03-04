import { z } from "zod";
import type { PermissionAuditLogger } from "./permission-audit.js";
import type { PermissionAuditEntry, PermissionAuditFilter } from "./permission-audit-types.js";

export const PermissionAnomalyWindowSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().positive(),
  baselineDurationMs: z.number().int().positive(),
});

export type PermissionAnomalyWindow = z.infer<typeof PermissionAnomalyWindowSchema>;

export const PermissionAnomalyTypeSchema = z.enum([
  "deny-rate-spike",
  "actor-tool-burst",
  "baseline-deviation",
]);

export type PermissionAnomalyType = z.infer<typeof PermissionAnomalyTypeSchema>;

export const PermissionAnomalySeveritySchema = z.enum(["info", "warning", "critical"]);

export type PermissionAnomalySeverity = z.infer<typeof PermissionAnomalySeveritySchema>;

export const PermissionAnomalySchema = z.object({
  id: z.string(),
  type: PermissionAnomalyTypeSchema,
  severity: PermissionAnomalySeveritySchema,
  windowId: z.string(),
  detectedAt: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  title: z.string(),
  summary: z.string(),
  metrics: z.record(z.string(), z.number()),
  thresholds: z.record(z.string(), z.number()),
  dimensions: z.record(z.string(), z.string()).optional(),
});

export type PermissionAnomaly = z.infer<typeof PermissionAnomalySchema>;

export const PermissionAnomalyReportSchema = z.object({
  generatedAt: z.string(),
  windows: z.array(
    z.object({
      id: z.string(),
      durationMs: z.number().int().positive(),
      baselineDurationMs: z.number().int().positive(),
      startTime: z.string(),
      baselineStartTime: z.string(),
      endTime: z.string(),
      evaluationCount: z.number().int().nonnegative(),
      baselineCount: z.number().int().nonnegative(),
      anomalies: z.array(PermissionAnomalySchema),
    }),
  ),
  summary: z.object({
    totalAnomalies: z.number().int().nonnegative(),
    byType: z.object({
      "deny-rate-spike": z.number().int().nonnegative(),
      "actor-tool-burst": z.number().int().nonnegative(),
      "baseline-deviation": z.number().int().nonnegative(),
    }),
    bySeverity: z.object({
      info: z.number().int().nonnegative(),
      warning: z.number().int().nonnegative(),
      critical: z.number().int().nonnegative(),
    }),
  }),
});

export type PermissionAnomalyReport = z.infer<typeof PermissionAnomalyReportSchema>;

export interface PermissionAnomalyDetectorConfig {
  auditLogger: PermissionAuditLogger;
  windows?: PermissionAnomalyWindow[];
  now?: () => Date;
  thresholds?: Partial<PermissionAnomalyThresholds>;
  filter?: Omit<PermissionAuditFilter, "startTime" | "endTime">;
}

export interface PermissionAnomalyThresholds {
  denyRateSpike: {
    minCurrentEvaluations: number;
    minBaselineEvaluations: number;
    spikeMultiplier: number;
    minAbsoluteIncrease: number;
    absoluteRateThreshold: number;
  };
  actorToolBurst: {
    minEvents: number;
    multiplier: number;
    minAbsoluteIncrease: number;
  };
  baselineDeviation: {
    minCurrentEvaluations: number;
    minDeviationRatio: number;
    minAbsoluteDelta: number;
  };
}

const DEFAULT_WINDOWS: PermissionAnomalyWindow[] = [
  { id: "5m", durationMs: 5 * 60_000, baselineDurationMs: 30 * 60_000 },
  { id: "1h", durationMs: 60 * 60_000, baselineDurationMs: 24 * 60 * 60_000 },
];

const DEFAULT_THRESHOLDS: PermissionAnomalyThresholds = {
  denyRateSpike: {
    minCurrentEvaluations: 10,
    minBaselineEvaluations: 20,
    spikeMultiplier: 2,
    minAbsoluteIncrease: 0.2,
    absoluteRateThreshold: 0.5,
  },
  actorToolBurst: {
    minEvents: 5,
    multiplier: 3,
    minAbsoluteIncrease: 3,
  },
  baselineDeviation: {
    minCurrentEvaluations: 10,
    minDeviationRatio: 1,
    minAbsoluteDelta: 10,
  },
};

export class PermissionAnomalyDetector {
  private readonly windows: PermissionAnomalyWindow[];
  private readonly now: () => Date;
  private readonly thresholds: PermissionAnomalyThresholds;

  constructor(private readonly config: PermissionAnomalyDetectorConfig) {
    this.windows = normalizeWindows(config.windows ?? DEFAULT_WINDOWS);
    this.now = config.now ?? (() => new Date());
    this.thresholds = {
      denyRateSpike: {
        ...DEFAULT_THRESHOLDS.denyRateSpike,
        ...(config.thresholds?.denyRateSpike ?? {}),
      },
      actorToolBurst: {
        ...DEFAULT_THRESHOLDS.actorToolBurst,
        ...(config.thresholds?.actorToolBurst ?? {}),
      },
      baselineDeviation: {
        ...DEFAULT_THRESHOLDS.baselineDeviation,
        ...(config.thresholds?.baselineDeviation ?? {}),
      },
    };
  }

  async detect(): Promise<PermissionAnomalyReport> {
    const endTime = this.now();
    const maxLookback = Math.max(
      ...this.windows.map((window) => window.durationMs + window.baselineDurationMs),
    );
    const startTime = new Date(endTime.getTime() - maxLookback);

    const entries = await this.loadEntries(startTime, endTime);
    const windows = this.windows.map((window) => this.detectForWindow(window, entries, endTime));

    const anomalies = windows.flatMap((window) => window.anomalies);
    const byType: Record<PermissionAnomalyType, number> = {
      "deny-rate-spike": 0,
      "actor-tool-burst": 0,
      "baseline-deviation": 0,
    };
    const bySeverity: Record<PermissionAnomalySeverity, number> = {
      info: 0,
      warning: 0,
      critical: 0,
    };

    for (const anomaly of anomalies) {
      byType[anomaly.type] += 1;
      bySeverity[anomaly.severity] += 1;
    }

    return {
      generatedAt: endTime.toISOString(),
      windows,
      summary: {
        totalAnomalies: anomalies.length,
        byType,
        bySeverity,
      },
    };
  }

  private async loadEntries(startTime: Date, endTime: Date): Promise<PermissionAuditEntry[]> {
    const pageSize = 500;
    let offset = 0;
    const entries: PermissionAuditEntry[] = [];

    while (true) {
      const page = await this.config.auditLogger.query(
        {
          ...(this.config.filter ?? {}),
          startTime,
          endTime,
        },
        pageSize,
        offset,
      );

      entries.push(...page.entries);

      if (!page.hasMore) {
        break;
      }

      offset += pageSize;
    }

    return entries.sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id),
    );
  }

  private detectForWindow(
    window: PermissionAnomalyWindow,
    entries: PermissionAuditEntry[],
    endTime: Date,
  ): PermissionAnomalyReport["windows"][number] {
    const endTimeMs = endTime.getTime();
    const windowStart = new Date(endTimeMs - window.durationMs);
    const baselineStart = new Date(windowStart.getTime() - window.baselineDurationMs);

    const currentEntries = entries.filter((entry) =>
      inRange(entry.timestamp, windowStart, endTime),
    );
    const baselineEntries = entries.filter((entry) =>
      inRange(entry.timestamp, baselineStart, windowStart),
    );

    const anomalies: PermissionAnomaly[] = [];

    const denyAnomaly = this.detectDenyRateSpike(
      window,
      currentEntries,
      baselineEntries,
      windowStart,
      endTime,
    );
    if (denyAnomaly) {
      anomalies.push(denyAnomaly);
    }

    anomalies.push(
      ...this.detectActorToolBurst(window, currentEntries, baselineEntries, windowStart, endTime),
    );

    const baselineDeviation = this.detectBaselineDeviation(
      window,
      currentEntries,
      baselineEntries,
      windowStart,
      endTime,
    );
    if (baselineDeviation) {
      anomalies.push(baselineDeviation);
    }

    anomalies.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));

    return {
      id: window.id,
      durationMs: window.durationMs,
      baselineDurationMs: window.baselineDurationMs,
      startTime: windowStart.toISOString(),
      baselineStartTime: baselineStart.toISOString(),
      endTime: endTime.toISOString(),
      evaluationCount: currentEntries.length,
      baselineCount: baselineEntries.length,
      anomalies,
    };
  }

  private detectDenyRateSpike(
    window: PermissionAnomalyWindow,
    currentEntries: PermissionAuditEntry[],
    baselineEntries: PermissionAuditEntry[],
    windowStart: Date,
    windowEnd: Date,
  ): PermissionAnomaly | null {
    const currentTotal = currentEntries.length;
    const baselineTotal = baselineEntries.length;

    if (currentTotal < this.thresholds.denyRateSpike.minCurrentEvaluations) return null;
    if (baselineTotal < this.thresholds.denyRateSpike.minBaselineEvaluations) return null;

    const currentDeny = currentEntries.filter((entry) => entry.result === "deny").length;
    const baselineDeny = baselineEntries.filter((entry) => entry.result === "deny").length;

    const currentRate = currentDeny / currentTotal;
    const baselineRate = baselineDeny / baselineTotal;
    const thresholdRate = Math.max(
      this.thresholds.denyRateSpike.absoluteRateThreshold,
      baselineRate * this.thresholds.denyRateSpike.spikeMultiplier,
    );

    if (currentRate < thresholdRate) return null;
    if (currentRate - baselineRate < this.thresholds.denyRateSpike.minAbsoluteIncrease) return null;

    return {
      id: `deny-rate-spike:${window.id}`,
      type: "deny-rate-spike",
      severity: currentRate >= 0.8 ? "critical" : "warning",
      windowId: window.id,
      detectedAt: windowEnd.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      title: "Deny-rate spike detected",
      summary: `Deny rate rose to ${(currentRate * 100).toFixed(1)}% from baseline ${(baselineRate * 100).toFixed(1)}%`,
      metrics: {
        currentTotal,
        currentDeny,
        currentRate,
        baselineTotal,
        baselineDeny,
        baselineRate,
      },
      thresholds: {
        minCurrentEvaluations: this.thresholds.denyRateSpike.minCurrentEvaluations,
        minBaselineEvaluations: this.thresholds.denyRateSpike.minBaselineEvaluations,
        spikeMultiplier: this.thresholds.denyRateSpike.spikeMultiplier,
        minAbsoluteIncrease: this.thresholds.denyRateSpike.minAbsoluteIncrease,
        absoluteRateThreshold: this.thresholds.denyRateSpike.absoluteRateThreshold,
      },
    };
  }

  private detectActorToolBurst(
    window: PermissionAnomalyWindow,
    currentEntries: PermissionAuditEntry[],
    baselineEntries: PermissionAuditEntry[],
    windowStart: Date,
    windowEnd: Date,
  ): PermissionAnomaly[] {
    const currentCounts = countByActorTool(currentEntries);
    const baselineCounts = countByActorTool(baselineEntries);

    const anomalies: PermissionAnomaly[] = [];

    for (const [key, currentCount] of currentCounts.entries()) {
      if (currentCount < this.thresholds.actorToolBurst.minEvents) {
        continue;
      }

      const baselineCount = baselineCounts.get(key) ?? 0;
      const expected = baselineCount * (window.durationMs / window.baselineDurationMs);
      const threshold = Math.max(
        expected * this.thresholds.actorToolBurst.multiplier,
        expected + this.thresholds.actorToolBurst.minAbsoluteIncrease,
      );

      if (currentCount < threshold) {
        continue;
      }

      const keyParts = key.split("::");
      const actor = keyParts[0] ?? "unknown";
      const tool = keyParts[1] ?? "unknown";

      anomalies.push({
        id: `actor-tool-burst:${window.id}:${actor}:${tool}`,
        type: "actor-tool-burst",
        severity: currentCount >= threshold * 2 ? "critical" : "warning",
        windowId: window.id,
        detectedAt: windowEnd.toISOString(),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        title: "Unusual actor/tool burst detected",
        summary: `Actor ${actor} with tool ${tool} produced ${currentCount} evaluations (baseline expected ${expected.toFixed(2)})`,
        dimensions: {
          actor,
          tool,
        },
        metrics: {
          currentCount,
          baselineCount,
          expectedCount: expected,
        },
        thresholds: {
          minEvents: this.thresholds.actorToolBurst.minEvents,
          multiplier: this.thresholds.actorToolBurst.multiplier,
          minAbsoluteIncrease: this.thresholds.actorToolBurst.minAbsoluteIncrease,
          thresholdCount: threshold,
        },
      });
    }

    return anomalies.sort((a, b) => a.id.localeCompare(b.id));
  }

  private detectBaselineDeviation(
    window: PermissionAnomalyWindow,
    currentEntries: PermissionAuditEntry[],
    baselineEntries: PermissionAuditEntry[],
    windowStart: Date,
    windowEnd: Date,
  ): PermissionAnomaly | null {
    const currentCount = currentEntries.length;
    const baselineCount = baselineEntries.length;
    const expected = baselineCount * (window.durationMs / window.baselineDurationMs);
    const delta = currentCount - expected;
    const deviationRatio = Math.abs(delta) / Math.max(expected, 1);

    if (currentCount < this.thresholds.baselineDeviation.minCurrentEvaluations) return null;
    if (Math.abs(delta) < this.thresholds.baselineDeviation.minAbsoluteDelta) return null;
    if (deviationRatio < this.thresholds.baselineDeviation.minDeviationRatio) return null;

    return {
      id: `baseline-deviation:${window.id}`,
      type: "baseline-deviation",
      severity: deviationRatio >= 2 ? "critical" : "warning",
      windowId: window.id,
      detectedAt: windowEnd.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      title: "Abrupt baseline deviation detected",
      summary: `Evaluation volume ${delta >= 0 ? "increased" : "decreased"} by ${delta.toFixed(2)} versus expected baseline ${expected.toFixed(2)}`,
      metrics: {
        currentCount,
        baselineCount,
        expectedCount: expected,
        delta,
        deviationRatio,
      },
      thresholds: {
        minCurrentEvaluations: this.thresholds.baselineDeviation.minCurrentEvaluations,
        minDeviationRatio: this.thresholds.baselineDeviation.minDeviationRatio,
        minAbsoluteDelta: this.thresholds.baselineDeviation.minAbsoluteDelta,
      },
    };
  }
}

export function createPermissionAnomalyDetector(
  config: PermissionAnomalyDetectorConfig,
): PermissionAnomalyDetector {
  return new PermissionAnomalyDetector(config);
}

function normalizeWindows(windows: PermissionAnomalyWindow[]): PermissionAnomalyWindow[] {
  const unique = new Map<string, PermissionAnomalyWindow>();

  for (const window of windows) {
    const parsed = PermissionAnomalyWindowSchema.parse(window);
    if (!unique.has(parsed.id)) {
      unique.set(parsed.id, parsed);
    }
  }

  return Array.from(unique.values()).sort(
    (a, b) => a.durationMs - b.durationMs || a.id.localeCompare(b.id),
  );
}

function inRange(timestamp: string, start: Date, end: Date): boolean {
  const value = Date.parse(timestamp);
  return value >= start.getTime() && value < end.getTime();
}

function countByActorTool(entries: PermissionAuditEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.actor}::${entry.tool ?? "unknown"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
