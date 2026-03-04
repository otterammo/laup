import { describe, expect, it, vi } from "vitest";
import {
  McpPropagationService,
  type McpPropagationTarget,
  measureMcpPropagationSlo,
} from "../mcp-propagation.js";
import type { McpServer } from "../mcp-schema.js";

const validServer: McpServer = {
  id: "acme/search",
  name: "Acme Search",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@acme/mcp-search"],
  scope: "project",
  enabled: true,
};

describe("McpPropagationService", () => {
  it("propagates a single registration to all MCP-capable targets", async () => {
    const received: string[] = [];

    const targets: McpPropagationTarget[] = [
      {
        toolId: "opencode",
        propagate: async (server) => {
          received.push(`opencode:${server.id}`);
        },
      },
      {
        toolId: "cursor",
        propagate: async (server) => {
          received.push(`cursor:${server.id}`);
        },
      },
    ];

    const service = new McpPropagationService(targets, { targetSloMs: 30_000 });
    const report = await service.propagateRegistration(validServer);

    expect(received).toEqual(["opencode:acme/search", "cursor:acme/search"]);
    expect(report.successCount).toBe(2);
    expect(report.failureCount).toBe(0);
    expect(report.targets.every((t) => t.success)).toBe(true);
  });

  it("returns per-target errors when propagation fails", async () => {
    const targets: McpPropagationTarget[] = [
      {
        toolId: "opencode",
        propagate: async () => {},
      },
      {
        toolId: "broken-tool",
        propagate: async () => {
          throw new Error("write failed");
        },
      },
    ];

    const service = new McpPropagationService(targets);
    const report = await service.propagateRegistration(validServer);

    expect(report.successCount).toBe(1);
    expect(report.failureCount).toBe(1);
    const failed = report.targets.find((t) => t.toolId === "broken-tool");
    expect(failed?.success).toBe(false);
    expect(failed?.error).toContain("write failed");
  });

  it("marks timed-out targets as failed with status", async () => {
    vi.useFakeTimers();

    const targets: McpPropagationTarget[] = [
      {
        toolId: "slow-tool",
        propagate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      },
    ];

    const service = new McpPropagationService(targets, { perTargetTimeoutMs: 10 });
    const reportPromise = service.propagateRegistration(validServer);

    await vi.advanceTimersByTimeAsync(100);
    const report = await reportPromise;

    expect(report.successCount).toBe(0);
    expect(report.failureCount).toBe(1);
    expect(report.targets[0]?.error).toContain("timed out");

    vi.useRealTimers();
  });

  it("throws on invalid MCP registration input", async () => {
    const service = new McpPropagationService([]);

    await expect(
      service.propagateRegistration({
        ...validServer,
        transport: "http",
        command: undefined,
      }),
    ).rejects.toThrow("Invalid MCP server registration");
  });
});

describe("measureMcpPropagationSlo", () => {
  it("reports in-SLO propagation", () => {
    const measurement = measureMcpPropagationSlo({
      totalDurationMs: 12_000,
      targetSloMs: 30_000,
    });

    expect(measurement.withinSlo).toBe(true);
    expect(measurement.budgetRemainingMs).toBe(18_000);
  });

  it("reports SLO violations", () => {
    const measurement = measureMcpPropagationSlo({
      totalDurationMs: 31_000,
      targetSloMs: 30_000,
    });

    expect(measurement.withinSlo).toBe(false);
    expect(measurement.budgetRemainingMs).toBe(-1_000);
  });
});
