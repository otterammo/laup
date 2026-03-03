import { z } from "zod";
import type { AuditEntry, AuditStorage } from "../audit-storage.js";
import type { KillSwitchState } from "./kill-switch.js";

export const SecurityDashboardWindowSchema = z.object({
  id: z.string().min(1),
  durationMs: z.number().int().positive(),
});

export type SecurityDashboardWindow = z.infer<typeof SecurityDashboardWindowSchema>;

export interface SecurityDashboardConfig {
  auditStorage: AuditStorage;
  windows?: SecurityDashboardWindow[];
  now?: () => Date;
  killSwitchStateProvider?: () => KillSwitchState;
}

export const SecurityDashboardMetricsSchema = z.object({
  authFailures: z.number().int().nonnegative(),
  hookVetoes: z.number().int().nonnegative(),
  rateLimitDenials: z.number().int().nonnegative(),
  guardDenials: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
});

export type SecurityDashboardMetrics = z.infer<typeof SecurityDashboardMetricsSchema>;

export const SecurityDashboardSnapshotSchema = z.object({
  generatedAt: z.string(),
  killSwitch: z.object({
    status: z.enum(["inactive", "activating", "active"]),
    state: z
      .object({
        status: z.enum(["inactive", "activating", "active"]),
        activationRequestedAt: z.string().optional(),
        activationDeadlineAt: z.string().optional(),
        activeAt: z.string().optional(),
        activatedBy: z.string().optional(),
        activationReason: z.string().optional(),
        deactivatedAt: z.string().optional(),
        deactivatedBy: z.string().optional(),
        deactivationReason: z.string().optional(),
      })
      .optional(),
  }),
  windows: z.array(
    z.object({
      id: z.string(),
      durationMs: z.number().int().positive(),
      startTime: z.string(),
      endTime: z.string(),
      metrics: SecurityDashboardMetricsSchema,
    }),
  ),
});

export type SecurityDashboardSnapshot = z.infer<typeof SecurityDashboardSnapshotSchema>;

const DEFAULT_WINDOWS: SecurityDashboardWindow[] = [
  { id: "5m", durationMs: 5 * 60_000 },
  { id: "1h", durationMs: 60 * 60_000 },
  { id: "24h", durationMs: 24 * 60 * 60_000 },
];

export class SecurityDashboardService {
  private readonly now: () => Date;
  private readonly windows: SecurityDashboardWindow[];

  constructor(private readonly config: SecurityDashboardConfig) {
    this.now = config.now ?? (() => new Date());
    this.windows = normalizeWindows(config.windows ?? DEFAULT_WINDOWS);
  }

  async snapshot(): Promise<SecurityDashboardSnapshot> {
    const endTime = this.now();
    const maxWindowDuration = Math.max(...this.windows.map((window) => window.durationMs));
    const startTime = new Date(endTime.getTime() - maxWindowDuration);

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

    const approvals = buildApprovalState(entries);

    const windowSnapshots = this.windows.map((window) => {
      const windowStart = new Date(endTime.getTime() - window.durationMs);
      const windowEntries = entries.filter((entry) => {
        const timestampMs = Date.parse(entry.timestamp);
        return timestampMs >= windowStart.getTime() && timestampMs < endTime.getTime();
      });

      return {
        id: window.id,
        durationMs: window.durationMs,
        startTime: windowStart.toISOString(),
        endTime: endTime.toISOString(),
        metrics: {
          authFailures: countByAction(windowEntries, "authenticate.failure"),
          hookVetoes: countByAction(windowEntries, "hook.pre.veto"),
          rateLimitDenials: countByAction(windowEntries, "rate-limit.enforce.deny"),
          guardDenials: countByAction(windowEntries, "resource-guard.enforce.deny"),
          pendingApprovals: countPendingApprovals(approvals, windowStart, endTime),
        },
      };
    });

    const killSwitchState = this.config.killSwitchStateProvider?.();

    return {
      generatedAt: endTime.toISOString(),
      killSwitch: {
        status: killSwitchState?.status ?? "inactive",
        ...(killSwitchState ? { state: killSwitchState } : {}),
      },
      windows: windowSnapshots,
    };
  }
}

export function createSecurityDashboardService(
  config: SecurityDashboardConfig,
): SecurityDashboardService {
  return new SecurityDashboardService(config);
}

interface ApprovalState {
  id: string;
  createdAt: string;
  createdAtMs: number;
  status: "pending" | "approved" | "denied" | "expired";
  updatedAtMs: number;
}

function buildApprovalState(entries: AuditEntry[]): Map<string, ApprovalState> {
  const approvals = new Map<string, ApprovalState>();

  const relevant = entries
    .filter((entry) => entry.action.startsWith("approval."))
    .slice()
    .sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
        a.id.localeCompare(b.id) ||
        a.action.localeCompare(b.action),
    );

  for (const entry of relevant) {
    const id = entry.targetId;
    if (!id) {
      continue;
    }

    const status = toApprovalStatus(entry);
    if (!status) {
      continue;
    }

    const current = approvals.get(id);
    if (!current) {
      approvals.set(id, {
        id,
        createdAt: entry.timestamp,
        createdAtMs: Date.parse(entry.timestamp),
        status,
        updatedAtMs: Date.parse(entry.timestamp),
      });
      continue;
    }

    const timestampMs = Date.parse(entry.timestamp);
    if (
      timestampMs > current.updatedAtMs ||
      (timestampMs === current.updatedAtMs && status !== current.status)
    ) {
      approvals.set(id, {
        ...current,
        status,
        updatedAtMs: timestampMs,
      });
    }
  }

  return approvals;
}

function toApprovalStatus(entry: AuditEntry): "pending" | "approved" | "denied" | "expired" | null {
  if (entry.action === "approval.request") return "pending";
  if (entry.action === "approval.approve" || entry.action === "approval.enforce.allow") {
    return "approved";
  }
  if (entry.action === "approval.deny" || entry.action === "approval.enforce.deny") {
    return "denied";
  }
  if (entry.action === "approval.expire" || entry.action === "approval.enforce.expired") {
    return "expired";
  }

  const status = entry.metadata?.["requestStatus"];
  if (
    status === "pending" ||
    status === "approved" ||
    status === "denied" ||
    status === "expired"
  ) {
    return status;
  }

  return null;
}

function countPendingApprovals(
  approvals: Map<string, ApprovalState>,
  windowStart: Date,
  endTime: Date,
): number {
  const windowStartMs = windowStart.getTime();
  const endTimeMs = endTime.getTime();
  let count = 0;

  for (const approval of approvals.values()) {
    if (approval.status !== "pending") {
      continue;
    }

    if (approval.createdAtMs >= windowStartMs && approval.createdAtMs < endTimeMs) {
      count += 1;
    }
  }

  return count;
}

function countByAction(entries: AuditEntry[], action: string): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.action === action) {
      count += 1;
    }
  }
  return count;
}

function normalizeWindows(windows: SecurityDashboardWindow[]): SecurityDashboardWindow[] {
  const unique = new Map<string, SecurityDashboardWindow>();

  for (const window of windows) {
    const parsed = SecurityDashboardWindowSchema.parse(window);
    if (!unique.has(parsed.id)) {
      unique.set(parsed.id, parsed);
    }
  }

  return Array.from(unique.values()).sort(
    (a, b) => a.durationMs - b.durationMs || a.id.localeCompare(b.id),
  );
}
