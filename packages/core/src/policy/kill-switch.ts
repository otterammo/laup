import type { AuditStorage } from "../audit-storage.js";

export type KillSwitchStatus = "inactive" | "activating" | "active";

export interface KillSwitchState {
  status: KillSwitchStatus;
  activationRequestedAt?: string;
  activationDeadlineAt?: string;
  activeAt?: string;
  activatedBy?: string;
  activationReason?: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
  deactivationReason?: string;
}

export interface KillSwitchActivationInput {
  actor: string;
  reason?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface KillSwitchDeactivationInput extends KillSwitchActivationInput {}

export interface KillSwitchEnforcementInput {
  actor: string;
  action: string;
  targetId?: string;
  targetType?: string;
  tool?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface EmergencyKillSwitchConfig {
  activationSlaMs?: number;
  protectedActions?: string[];
  auditStorage?: AuditStorage;
  now?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_ACTIVATION_SLA_MS = 30_000;

export class KillSwitchBlockedError extends Error {
  readonly code = "KILL_SWITCH_ACTIVE";

  constructor(message = "Emergency kill-switch is active") {
    super(message);
    this.name = "KillSwitchBlockedError";
  }
}

export class EmergencyKillSwitch {
  private readonly activationSlaMs: number;
  private readonly protectedActions: string[];
  private readonly now: () => Date;
  private readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearSchedule: (timer: ReturnType<typeof setTimeout>) => void;

  private state: KillSwitchState = { status: "inactive" };
  private activationTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly config: EmergencyKillSwitchConfig = {}) {
    this.activationSlaMs = Math.max(config.activationSlaMs ?? DEFAULT_ACTIVATION_SLA_MS, 1);
    this.protectedActions = config.protectedActions ?? ["*"];
    this.now = config.now ?? (() => new Date());
    this.schedule = config.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearSchedule = config.clearSchedule ?? ((timer) => clearTimeout(timer));
  }

  getState(): KillSwitchState {
    return { ...this.state };
  }

  async activate(input: KillSwitchActivationInput): Promise<KillSwitchState> {
    if (this.state.status !== "inactive") {
      return this.getState();
    }

    const requestedAt = this.now();
    const deadlineAt = new Date(requestedAt.getTime() + this.activationSlaMs);

    this.state = {
      status: "activating",
      activationRequestedAt: requestedAt.toISOString(),
      activationDeadlineAt: deadlineAt.toISOString(),
      activatedBy: input.actor,
      ...(input.reason ? { activationReason: input.reason } : {}),
    };

    this.scheduleActivationFinalize();

    await this.audit("kill-switch.activate", "critical", input.actor, {
      ...input,
      metadata: {
        activationSlaMs: this.activationSlaMs,
        activationDeadlineAt: deadlineAt.toISOString(),
      },
    });

    return this.getState();
  }

  async deactivate(input: KillSwitchDeactivationInput): Promise<KillSwitchState> {
    this.cancelActivationFinalize();

    const previousStatus = this.state.status;
    const now = this.now().toISOString();
    this.state = {
      status: "inactive",
      deactivatedAt: now,
      deactivatedBy: input.actor,
      ...(input.reason ? { deactivationReason: input.reason } : {}),
    };

    await this.audit("kill-switch.deactivate", "warning", input.actor, {
      ...input,
      metadata: {
        previousStatus,
      },
    });

    return this.getState();
  }

  async enforce(input: KillSwitchEnforcementInput): Promise<void> {
    const shouldProtect = this.isProtectedAction(input.action);
    if (!shouldProtect) {
      return;
    }

    if (this.state.status === "inactive") {
      return;
    }

    await this.audit("kill-switch.enforce.block", "critical", input.actor, {
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.tool ? { tool: input.tool } : {}),
      action: input.action,
      metadata: {
        killSwitchStatus: this.state.status,
        ...(this.state.activationRequestedAt
          ? { activationRequestedAt: this.state.activationRequestedAt }
          : {}),
        ...(this.state.activeAt ? { activeAt: this.state.activeAt } : {}),
      },
    });

    throw new KillSwitchBlockedError();
  }

  private scheduleActivationFinalize(): void {
    this.cancelActivationFinalize();

    this.activationTimer = this.schedule(() => {
      if (this.state.status !== "activating") {
        return;
      }

      this.state = {
        ...this.state,
        status: "active",
        activeAt: this.now().toISOString(),
      };
    }, this.activationSlaMs);
  }

  private cancelActivationFinalize(): void {
    if (!this.activationTimer) {
      return;
    }

    this.clearSchedule(this.activationTimer);
    this.activationTimer = undefined;
  }

  private isProtectedAction(action: string): boolean {
    try {
      return this.protectedActions.some((pattern) => matchesPattern(action, pattern));
    } catch {
      // Fail closed when matcher encounters malformed state/pattern.
      return true;
    }
  }

  private async audit(
    action: string,
    severity: "info" | "warning" | "critical",
    actor: string,
    input: {
      correlationId?: string;
      ipAddress?: string;
      userAgent?: string;
      targetId?: string;
      targetType?: string;
      metadata?: Record<string, unknown>;
      reason?: string;
      action?: string;
      tool?: string;
    },
  ): Promise<void> {
    if (!this.config.auditStorage) {
      return;
    }

    await this.config.auditStorage.append({
      category: "security",
      action,
      actor,
      targetId: input.targetId,
      targetType: input.targetType ?? "permission-action",
      severity,
      reason: input.reason,
      correlationId: input.correlationId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: {
        killSwitchStatus: this.state.status,
        protectedAction: input.action,
        tool: input.tool,
        ...input.metadata,
      },
    });
  }
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }

  if (pattern.startsWith("*")) {
    return value.endsWith(pattern.slice(1));
  }

  return value === pattern;
}

export function createEmergencyKillSwitch(
  config: EmergencyKillSwitchConfig = {},
): EmergencyKillSwitch {
  return new EmergencyKillSwitch(config);
}
