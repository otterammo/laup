import { z } from "zod";
import type { AuditEntry, AuditStorage } from "../audit-storage.js";

export const PolicyNotificationSeveritySchema = z.enum(["info", "warning", "critical"]);
export type PolicyNotificationSeverity = z.infer<typeof PolicyNotificationSeveritySchema>;

export const DenialSpikeWindowSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().positive(),
  threshold: z.number().int().positive(),
});

export type DenialSpikeWindow = z.infer<typeof DenialSpikeWindowSchema>;

export const PolicyNotificationSchema = z.object({
  id: z.string(),
  type: z.enum([
    "kill-switch.state-change",
    "approval.request",
    "approval.decision",
    "approval.timeout",
    "denial.spike",
  ]),
  severity: PolicyNotificationSeveritySchema,
  occurredAt: z.string(),
  title: z.string(),
  summary: z.string(),
  correlationId: z.string().optional(),
  actor: z.string().optional(),
  sourceEventId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PolicyNotification = z.infer<typeof PolicyNotificationSchema>;

export interface PolicyNotificationAggregationConfig {
  auditStorage: AuditStorage;
  denialSpikeWindows?: DenialSpikeWindow[];
  now?: () => Date;
  denialMatcher?: (entry: AuditEntry) => boolean;
}

export interface PolicyNotificationAggregationInput {
  startTime: Date;
  endTime?: Date;
}

const DEFAULT_DENIAL_SPIKE_WINDOWS: DenialSpikeWindow[] = [
  { id: "5m", durationMs: 5 * 60_000, threshold: 10 },
  { id: "15m", durationMs: 15 * 60_000, threshold: 25 },
];

export class PolicyNotificationAggregator {
  private readonly now: () => Date;
  private readonly denialSpikeWindows: DenialSpikeWindow[];
  private readonly denialMatcher: (entry: AuditEntry) => boolean;

  constructor(private readonly config: PolicyNotificationAggregationConfig) {
    this.now = config.now ?? (() => new Date());
    this.denialSpikeWindows = normalizeDenialSpikeWindows(
      config.denialSpikeWindows ?? DEFAULT_DENIAL_SPIKE_WINDOWS,
    );
    this.denialMatcher = config.denialMatcher ?? isDenialEvent;
  }

  async aggregate(input: PolicyNotificationAggregationInput): Promise<PolicyNotification[]> {
    const endTime = input.endTime ?? this.now();
    const maxWindowMs = Math.max(...this.denialSpikeWindows.map((window) => window.durationMs));
    const effectiveStart = new Date(
      Math.min(input.startTime.getTime(), endTime.getTime() - maxWindowMs),
    );

    const entries = await this.fetchEntries(effectiveStart, endTime);
    const inWindowEntries = entries.filter((entry) => {
      const timestampMs = Date.parse(entry.timestamp);
      return timestampMs >= input.startTime.getTime() && timestampMs < endTime.getTime();
    });

    const notifications = inWindowEntries
      .map((entry) => mapAuditEventToNotification(entry))
      .filter((notification): notification is PolicyNotification => notification !== null);

    const denialNotifications = this.detectDenialSpikes(entries, input.startTime, endTime);

    return [...notifications, ...denialNotifications].sort(
      (a, b) =>
        Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
        a.id.localeCompare(b.id) ||
        a.type.localeCompare(b.type),
    );
  }

  private async fetchEntries(startTime: Date, endTime: Date): Promise<AuditEntry[]> {
    const pageSize = 500;
    let offset = 0;
    const entries: AuditEntry[] = [];

    while (true) {
      const page = await this.config.auditStorage.query({ startTime, endTime }, pageSize, offset);
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

  private detectDenialSpikes(
    entries: AuditEntry[],
    startTime: Date,
    endTime: Date,
  ): PolicyNotification[] {
    const notifications: PolicyNotification[] = [];

    for (const window of this.denialSpikeWindows) {
      const windowStart = new Date(endTime.getTime() - window.durationMs);
      const boundedStart = windowStart.getTime() < startTime.getTime() ? startTime : windowStart;
      const windowDenials = entries.filter((entry) => {
        const timestampMs = Date.parse(entry.timestamp);
        return (
          timestampMs >= boundedStart.getTime() &&
          timestampMs < endTime.getTime() &&
          this.denialMatcher(entry)
        );
      });

      if (windowDenials.length < window.threshold) {
        continue;
      }

      notifications.push({
        id: `denial-spike:${window.id}:${endTime.toISOString()}`,
        type: "denial.spike",
        severity: "critical",
        occurredAt: endTime.toISOString(),
        title: "Denial spike detected",
        summary: `${windowDenials.length} denials in ${window.id} window (threshold ${window.threshold})`,
        metadata: {
          windowId: window.id,
          windowDurationMs: window.durationMs,
          threshold: window.threshold,
          denialCount: windowDenials.length,
          startTime: boundedStart.toISOString(),
          endTime: endTime.toISOString(),
          sourceEventIds: windowDenials.map((entry) => entry.id),
        },
      });
    }

    return notifications;
  }
}

export function createPolicyNotificationAggregator(
  config: PolicyNotificationAggregationConfig,
): PolicyNotificationAggregator {
  return new PolicyNotificationAggregator(config);
}

function mapAuditEventToNotification(entry: AuditEntry): PolicyNotification | null {
  if (entry.action === "kill-switch.activate") {
    return {
      id: `notification:${entry.id}`,
      type: "kill-switch.state-change",
      severity: "critical",
      occurredAt: entry.timestamp,
      title: "Kill-switch activating",
      summary: "Emergency kill-switch activation requested",
      correlationId: entry.correlationId,
      actor: entry.actor,
      sourceEventId: entry.id,
      metadata: {
        state: "activating",
        reason: entry.reason,
        ...entry.metadata,
      },
    };
  }

  if (entry.action === "kill-switch.deactivate") {
    return {
      id: `notification:${entry.id}`,
      type: "kill-switch.state-change",
      severity: "warning",
      occurredAt: entry.timestamp,
      title: "Kill-switch deactivated",
      summary: "Emergency kill-switch returned to inactive state",
      correlationId: entry.correlationId,
      actor: entry.actor,
      sourceEventId: entry.id,
      metadata: {
        state: "inactive",
        reason: entry.reason,
        ...entry.metadata,
      },
    };
  }

  if (entry.action === "approval.request") {
    return {
      id: `notification:${entry.id}`,
      type: "approval.request",
      severity: "warning",
      occurredAt: entry.timestamp,
      title: "Approval required",
      summary: "New approval request pending decision",
      correlationId: entry.correlationId,
      actor: entry.actor,
      sourceEventId: entry.id,
      metadata: entry.metadata,
    };
  }

  if (entry.action === "approval.approve" || entry.action === "approval.deny") {
    const approved = entry.action === "approval.approve";
    return {
      id: `notification:${entry.id}`,
      type: "approval.decision",
      severity: approved ? "info" : "warning",
      occurredAt: entry.timestamp,
      title: approved ? "Approval granted" : "Approval denied",
      summary: approved ? "Approval request was approved" : "Approval request was denied",
      correlationId: entry.correlationId,
      actor: entry.actor,
      sourceEventId: entry.id,
      metadata: {
        decision: approved ? "approved" : "denied",
        ...entry.metadata,
      },
    };
  }

  if (entry.action === "approval.expire" || entry.action === "approval.enforce.expired") {
    return {
      id: `notification:${entry.id}`,
      type: "approval.timeout",
      severity: "warning",
      occurredAt: entry.timestamp,
      title: "Approval timed out",
      summary: "Approval request expired before decision",
      correlationId: entry.correlationId,
      actor: entry.actor,
      sourceEventId: entry.id,
      metadata: entry.metadata,
    };
  }

  return null;
}

function isDenialEvent(entry: AuditEntry): boolean {
  if (entry.action === "approval.deny" || entry.action === "approval.enforce.deny") {
    return true;
  }

  if (entry.category === "security" && entry.action.endsWith(".deny")) {
    return true;
  }

  if (entry.category === "access") {
    const result = entry.metadata?.["result"];
    if (result === "deny") {
      return true;
    }
  }

  return false;
}

function normalizeDenialSpikeWindows(windows: DenialSpikeWindow[]): DenialSpikeWindow[] {
  const unique = new Map<string, DenialSpikeWindow>();

  for (const window of windows) {
    const parsed = DenialSpikeWindowSchema.parse(window);
    if (!unique.has(parsed.id)) {
      unique.set(parsed.id, parsed);
    }
  }

  return Array.from(unique.values()).sort(
    (a, b) => a.durationMs - b.durationMs || a.id.localeCompare(b.id),
  );
}
