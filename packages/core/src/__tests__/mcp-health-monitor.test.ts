import { describe, expect, it, vi } from "vitest";
import { McpHealthMonitorService, type McpServerRegistryLike } from "../mcp-health-monitor.js";
import type { McpServer } from "../mcp-schema.js";

const server: McpServer = {
  id: "acme/search",
  name: "Acme Search",
  transport: "http",
  url: "https://example.com/mcp",
  scope: "project",
  enabled: true,
  healthCheck: {
    enabled: true,
    intervalSeconds: 30,
    timeoutSeconds: 1,
    failureThreshold: 2,
    successThreshold: 2,
  },
};

function createRegistry(servers: McpServer[]): McpServerRegistryLike {
  return {
    list: async () => servers,
  };
}

describe("McpHealthMonitorService", () => {
  it("marks a server healthy after successful checks", async () => {
    const monitor = new McpHealthMonitorService(createRegistry([server]), async () => ({
      success: true,
      message: "ok",
    }));

    await monitor.runChecks();
    await monitor.runChecks();

    const state = monitor.getState(server.id);
    expect(state?.status).toBe("healthy");
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.lastCheckStatus?.success).toBe(true);
  });

  it("transitions to unhealthy after threshold failures and recovers", async () => {
    const responses = [
      { success: false, message: "down" },
      { success: false, message: "still down" },
      { success: true, message: "back" },
      { success: true, message: "stable" },
    ];

    const onUnhealthy = vi.fn();
    const onAudit = vi.fn();

    const monitor = new McpHealthMonitorService(
      createRegistry([server]),
      async () => responses.shift() ?? { success: true, message: "ok" },
      {},
      { onUnhealthy, onAudit },
    );

    await monitor.runChecks();
    expect(monitor.getState(server.id)?.status).toBe("degraded");

    await monitor.runChecks();
    expect(monitor.getState(server.id)?.status).toBe("unhealthy");
    expect(onUnhealthy).toHaveBeenCalledTimes(1);
    expect(onAudit).toHaveBeenCalledTimes(2);

    await monitor.runChecks();
    expect(monitor.getState(server.id)?.status).toBe("degraded");

    await monitor.runChecks();
    expect(monitor.getState(server.id)?.status).toBe("healthy");
  });

  it("marks timeout checks as failures", async () => {
    vi.useFakeTimers();

    const monitor = new McpHealthMonitorService(
      createRegistry([
        {
          ...server,
          healthCheck: {
            enabled: true,
            intervalSeconds: 30,
            timeoutSeconds: 1,
            failureThreshold: 1,
            successThreshold: 2,
          },
        },
      ]),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return { success: true, message: "late" };
      },
      { timeoutMs: 100, failureThreshold: 1 },
    );

    const runPromise = monitor.runChecks();
    await vi.advanceTimersByTimeAsync(6_000);
    await runPromise;

    const state = monitor.getState(server.id);
    expect(state?.status).toBe("unhealthy");
    expect(state?.lastCheckStatus?.timedOut).toBe(true);
    expect(state?.lastCheckStatus?.success).toBe(false);

    vi.useRealTimers();
  });

  it("retries failed checks according to retry policy", async () => {
    let attempts = 0;
    const monitor = new McpHealthMonitorService(
      createRegistry([
        {
          ...server,
          healthCheck: {
            enabled: true,
            intervalSeconds: 30,
            timeoutSeconds: 1,
            failureThreshold: 2,
            successThreshold: 1,
          },
        },
      ]),
      async () => {
        attempts += 1;
        if (attempts < 3) return { success: false, message: "flaky" };
        return { success: true, message: "ok" };
      },
      { retries: 2, failureThreshold: 2, successThreshold: 1 },
    );

    await monitor.runChecks();

    const state = monitor.getState(server.id);
    expect(attempts).toBe(3);
    expect(state?.status).toBe("healthy");
    expect(state?.lastCheckStatus?.retries).toBe(1);
  });

  it("periodically checks when started", async () => {
    vi.useFakeTimers();
    const checker = vi.fn(async () => ({ success: true }));

    const monitor = new McpHealthMonitorService(createRegistry([server]), checker, {
      intervalMs: 1_000,
    });

    monitor.start();
    await vi.advanceTimersByTimeAsync(3_500);
    monitor.stop();

    expect(checker).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
