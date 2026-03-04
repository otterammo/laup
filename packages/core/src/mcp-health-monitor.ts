import type {
  McpHealthCheck,
  McpHealthState,
  McpHealthStatus,
  McpLastCheckStatus,
  McpServer,
} from "./mcp-schema.js";

export interface McpServerRegistryLike {
  list(): Promise<McpServer[]>;
}

export interface McpHealthTransition {
  serverId: string;
  previousStatus: McpHealthStatus;
  currentStatus: McpHealthStatus;
  state: McpHealthState;
  lastCheckStatus: McpLastCheckStatus;
}

export interface McpHealthMonitorConfig {
  intervalMs?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  failureThreshold?: number;
  successThreshold?: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  sleep?: (ms: number) => Promise<void>;
}

export interface McpHealthMonitorHooks {
  onTransition?: (transition: McpHealthTransition) => void | Promise<void>;
  onUnhealthy?: (transition: McpHealthTransition) => void | Promise<void>;
  onAudit?: (transition: McpHealthTransition) => void | Promise<void>;
  onCheckComplete?: (state: McpHealthState) => void | Promise<void>;
}

export type McpLivenessChecker = (
  server: McpServer,
  timeoutMs: number,
) => Promise<{
  success: boolean;
  message?: string;
}>;

const DEFAULT_CONFIG = {
  intervalMs: 60_000,
  timeoutMs: 10_000,
  retries: 0,
  retryDelayMs: 0,
  failureThreshold: 3,
  successThreshold: 1,
} as const;

type RuntimeConfig = {
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  failureThreshold: number;
  successThreshold: number;
  now: () => number;
  setIntervalFn: typeof setInterval;
  clearIntervalFn: typeof clearInterval;
  sleep: (ms: number) => Promise<void>;
};

type ResolvedPolicy = {
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  failureThreshold: number;
  successThreshold: number;
};

export class McpHealthMonitorService {
  private readonly registry: McpServerRegistryLike;
  private readonly checker: McpLivenessChecker;
  private readonly hooks: McpHealthMonitorHooks;
  private readonly config: RuntimeConfig;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly states = new Map<string, McpHealthState>();
  private readonly successStreaks = new Map<string, number>();

  constructor(
    registry: McpServerRegistryLike,
    checker: McpLivenessChecker,
    config: McpHealthMonitorConfig = {},
    hooks: McpHealthMonitorHooks = {},
  ) {
    this.registry = registry;
    this.checker = checker;
    this.hooks = hooks;
    this.config = {
      intervalMs: config.intervalMs ?? DEFAULT_CONFIG.intervalMs,
      timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
      retries: config.retries ?? DEFAULT_CONFIG.retries,
      retryDelayMs: config.retryDelayMs ?? DEFAULT_CONFIG.retryDelayMs,
      failureThreshold: config.failureThreshold ?? DEFAULT_CONFIG.failureThreshold,
      successThreshold: config.successThreshold ?? DEFAULT_CONFIG.successThreshold,
      now: config.now ?? Date.now,
      setIntervalFn: config.setIntervalFn ?? setInterval,
      clearIntervalFn: config.clearIntervalFn ?? clearInterval,
      sleep: config.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    };
  }

  start(): void {
    if (this.intervalHandle) return;

    this.intervalHandle = this.config.setIntervalFn(() => {
      void this.runChecks();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (!this.intervalHandle) return;

    this.config.clearIntervalFn(this.intervalHandle);
    this.intervalHandle = null;
  }

  async runChecks(): Promise<Map<string, McpHealthState>> {
    const servers = await this.registry.list();
    const enabledServers = servers.filter((s) => s.enabled && s.healthCheck?.enabled !== false);

    await Promise.all(enabledServers.map((server) => this.checkServer(server)));
    return new Map(this.states);
  }

  getState(serverId: string): McpHealthState | undefined {
    const state = this.states.get(serverId);
    return state ? { ...state } : undefined;
  }

  getAllStates(): McpHealthState[] {
    return Array.from(this.states.values()).map((s) => ({ ...s }));
  }

  private async checkServer(server: McpServer): Promise<void> {
    const policy = resolvePolicy(server.healthCheck, this.config);
    const startedAt = this.config.now();

    let retriesUsed = 0;
    let timedOut = false;
    let result: { success: boolean; message?: string } = { success: false, message: "Unknown" };

    for (let attempt = 0; attempt <= policy.retries; attempt += 1) {
      const checkResult = await withTimeout(
        this.checker(server, policy.timeoutMs),
        policy.timeoutMs,
      );

      if (checkResult.timedOut) {
        timedOut = true;
        result = { success: false, message: `Health check timed out after ${policy.timeoutMs}ms` };
      } else {
        result = checkResult.result;
      }

      if (result.success) break;

      retriesUsed = attempt;
      if (attempt < policy.retries && policy.retryDelayMs > 0) {
        await this.config.sleep(policy.retryDelayMs);
      }
    }

    const checkedAt = this.config.now();
    const lastCheckStatus: McpLastCheckStatus = {
      checkedAt,
      durationMs: checkedAt - startedAt,
      success: result.success,
      timedOut,
      retries: retriesUsed,
    };

    if (result.message) {
      lastCheckStatus.message = result.message;
      if (!result.success) {
        lastCheckStatus.error = result.message;
      }
    }

    await this.updateState(server, policy, result.success, result.message, lastCheckStatus);
  }

  private async updateState(
    server: McpServer,
    policy: ResolvedPolicy,
    success: boolean,
    message: string | undefined,
    lastCheckStatus: McpLastCheckStatus,
  ): Promise<void> {
    const previous = this.states.get(server.id) ?? {
      serverId: server.id,
      status: "unknown" as McpHealthStatus,
      lastCheck: 0,
      consecutiveFailures: 0,
    };

    let consecutiveFailures = previous.consecutiveFailures;
    let successStreak = this.successStreaks.get(server.id) ?? 0;
    let status: McpHealthStatus;

    if (success) {
      consecutiveFailures = 0;
      successStreak += 1;
      status = successStreak >= policy.successThreshold ? "healthy" : "degraded";
    } else {
      consecutiveFailures += 1;
      successStreak = 0;
      status = consecutiveFailures >= policy.failureThreshold ? "unhealthy" : "degraded";
    }

    this.successStreaks.set(server.id, successStreak);

    const state: McpHealthState = {
      serverId: server.id,
      status,
      lastCheck: lastCheckStatus.checkedAt,
      consecutiveFailures,
      lastCheckStatus,
    };

    if (success) {
      state.lastSuccess = lastCheckStatus.checkedAt;
      if (previous.lastFailure !== undefined) {
        state.lastFailure = previous.lastFailure;
      }
    } else {
      state.lastFailure = lastCheckStatus.checkedAt;
      if (previous.lastSuccess !== undefined) {
        state.lastSuccess = previous.lastSuccess;
      }
    }

    if (message) {
      state.message = message;
    }

    this.states.set(server.id, state);

    await this.hooks.onCheckComplete?.(state);

    if (previous.status !== status) {
      const transition: McpHealthTransition = {
        serverId: server.id,
        previousStatus: previous.status,
        currentStatus: status,
        state,
        lastCheckStatus,
      };

      await this.hooks.onTransition?.(transition);
      await this.hooks.onAudit?.(transition);

      if (status === "unhealthy") {
        await this.hooks.onUnhealthy?.(transition);
      }
    }
  }
}

function resolvePolicy(
  healthCheck: McpHealthCheck | undefined,
  config: RuntimeConfig,
): ResolvedPolicy {
  return {
    intervalMs: healthCheck ? healthCheck.intervalSeconds * 1000 : config.intervalMs,
    timeoutMs: healthCheck ? healthCheck.timeoutSeconds * 1000 : config.timeoutMs,
    retries: config.retries,
    retryDelayMs: config.retryDelayMs,
    failureThreshold: healthCheck?.failureThreshold ?? config.failureThreshold,
    successThreshold: healthCheck?.successThreshold ?? config.successThreshold,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: boolean; result: T }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);

    return { timedOut: false, result };
  } catch {
    return {
      timedOut: true,
      result: {
        success: false,
        message: `Health check timed out after ${timeoutMs}ms`,
      } as T,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
