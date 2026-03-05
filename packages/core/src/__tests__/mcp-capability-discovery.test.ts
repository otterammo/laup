import { describe, expect, it } from "vitest";
import { McpCapabilityDiscoveryService } from "../mcp-capability-discovery.js";
import { InMemoryMcpServerRegistry } from "../mcp-registry.js";
import type { McpServer } from "../mcp-schema.js";

describe("mcp-capability-discovery", () => {
  const baseServer: McpServer = {
    id: "acme/search",
    name: "Search",
    transport: "http",
    url: "https://example.com/mcp",
    scope: "project",
    scopeId: "proj-1",
    enabled: true,
  };

  it("discovers capabilities and exposes dashboard snapshot", async () => {
    const registry = new InMemoryMcpServerRegistry();
    await registry.init();
    await registry.register(baseServer, { actor: "alice" });

    const discovery = new McpCapabilityDiscoveryService(registry, {
      discover: async () => ({
        capabilities: ["Search.Web", "fetch-docs", "search.web"],
      }),
    });

    await discovery.refreshAll();

    const server = await registry.get(baseServer.id, baseServer.scope, baseServer.scopeId);
    expect(server?.capabilities).toEqual(["fetch-docs", "search.web"]);

    const dashboard = await discovery.dashboardSnapshot();
    expect(dashboard.totalServers).toBe(1);
    expect(dashboard.serversWithCapabilities).toBe(1);
    expect(dashboard.uniqueCapabilities).toEqual(["fetch-docs", "search.web"]);
    expect(dashboard.servers[0]?.status).toBe("ready");
  });

  it("supports natural-language capability lookups", async () => {
    const registry = new InMemoryMcpServerRegistry();
    await registry.init();

    await registry.register(
      {
        ...baseServer,
        capabilities: ["search.web", "fetch-docs"],
      },
      { actor: "alice" },
    );

    await registry.register(
      {
        ...baseServer,
        id: "acme/calendar",
        name: "Calendar",
        capabilities: ["calendar.read", "calendar.write"],
      },
      { actor: "alice" },
    );

    const discovery = new McpCapabilityDiscoveryService(registry, {
      discover: async () => ({ capabilities: [] }),
    });

    const result = await discovery.queryByNaturalLanguage(
      "Which MCP servers can do calendar read?",
    );

    expect(result.matches).toEqual([
      {
        capability: "calendar.read",
        servers: ["acme/calendar"],
      },
      {
        capability: "calendar.write",
        servers: ["acme/calendar"],
      },
    ]);
  });

  it("refreshes on server update and supports periodic refresh intervals", async () => {
    const registry = new InMemoryMcpServerRegistry();
    await registry.init();
    await registry.register(baseServer, { actor: "alice" });

    const seen: string[] = [];
    let periodicTick: (() => void) | undefined;

    const discovery = new McpCapabilityDiscoveryService(
      registry,
      {
        discover: async (server) => {
          seen.push(server.name);
          return {
            capabilities: [server.name.toLowerCase()],
          };
        },
      },
      {
        setIntervalFn: ((handler: () => void) => {
          periodicTick = () => {
            handler();
          };
          return 1 as unknown as ReturnType<typeof setInterval>;
        }) as typeof setInterval,
        clearIntervalFn: (() => {}) as typeof clearInterval,
      },
    );

    await discovery.refreshAll();
    expect(seen).toEqual(["Search"]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.update({ ...baseServer, name: "Search v2" }, { actor: "alice" });
    await discovery.refreshAll();
    expect(seen).toEqual(["Search", "Search v2"]);

    discovery.start();
    periodicTick?.();
    await Promise.resolve();

    expect(seen).toEqual(["Search", "Search v2", "Search v2"]);

    discovery.stop();
  });
});
