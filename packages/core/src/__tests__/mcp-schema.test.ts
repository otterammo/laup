import { describe, expect, it } from "vitest";
import {
  getServersAtScope,
  isServerHealthy,
  type McpHealthState,
  type McpServer,
  parseServerId,
  resolveEffectiveServers,
  validateMcpServer,
} from "../mcp-schema.js";

describe("mcp-schema", () => {
  const validStdioServer: McpServer = {
    id: "acme/code-tools",
    name: "Code Tools",
    description: "Code analysis tools",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@acme/code-tools"],
    scope: "project",
    enabled: true,
  };

  const validHttpServer: McpServer = {
    id: "acme/api-server",
    name: "API Server",
    transport: "http",
    url: "https://api.example.com/mcp",
    scope: "org",
    enabled: true,
  };

  describe("validateMcpServer", () => {
    it("validates valid stdio server", () => {
      const result = validateMcpServer(validStdioServer);
      expect(result.valid).toBe(true);
      expect(result.server).toBeDefined();
    });

    it("validates valid http server", () => {
      const result = validateMcpServer(validHttpServer);
      expect(result.valid).toBe(true);
    });

    it("requires command for stdio transport", () => {
      const result = validateMcpServer({
        ...validStdioServer,
        command: undefined,
      });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "command")).toBe(true);
    });

    it("requires url for http transport", () => {
      const result = validateMcpServer({
        ...validHttpServer,
        url: undefined,
      });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "url")).toBe(true);
    });

    it("validates server with credentials", () => {
      const result = validateMcpServer({
        ...validHttpServer,
        credentials: {
          key: "acme-api-key",
          type: "api-key",
          envVar: "ACME_API_KEY",
        },
      });
      expect(result.valid).toBe(true);
    });

    it("validates server with version pinning", () => {
      const result = validateMcpServer({
        ...validStdioServer,
        version: {
          minVersion: "1.0.0",
          maxVersion: "2.0.0",
          autoUpdate: true,
          notifyOnUpdate: true,
        },
      });
      expect(result.valid).toBe(true);
    });

    it("validates server with health check", () => {
      const result = validateMcpServer({
        ...validHttpServer,
        healthCheck: {
          enabled: true,
          intervalSeconds: 30,
          timeoutSeconds: 5,
          failureThreshold: 3,
          endpoint: "/health",
        },
      });
      expect(result.valid).toBe(true);
    });

    it("rejects invalid server id format", () => {
      const result = validateMcpServer({
        ...validStdioServer,
        id: "invalid id with spaces",
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("isServerHealthy", () => {
    it("returns true for healthy status", () => {
      const state: McpHealthState = {
        serverId: "test",
        status: "healthy",
        lastCheck: Date.now(),
        consecutiveFailures: 0,
      };
      expect(isServerHealthy(state)).toBe(true);
    });

    it("returns false for unhealthy status", () => {
      const state: McpHealthState = {
        serverId: "test",
        status: "unhealthy",
        lastCheck: Date.now(),
        consecutiveFailures: 3,
      };
      expect(isServerHealthy(state)).toBe(false);
    });
  });

  describe("getServersAtScope", () => {
    const servers: McpServer[] = [
      { ...validStdioServer, id: "org-server", scope: "org", scopeId: "acme" },
      { ...validStdioServer, id: "team-server", scope: "team", scopeId: "team-a" },
      { ...validStdioServer, id: "project-server", scope: "project", scopeId: "proj-1" },
    ];

    it("filters by scope level", () => {
      const orgServers = getServersAtScope(servers, "org");
      expect(orgServers).toHaveLength(1);
      expect(orgServers[0]?.id).toBe("org-server");
    });

    it("filters by scope and scopeId", () => {
      const teamServers = getServersAtScope(servers, "team", "team-a");
      expect(teamServers).toHaveLength(1);
      expect(teamServers[0]?.id).toBe("team-server");
    });
  });

  describe("resolveEffectiveServers (MCP-004)", () => {
    it("returns all servers when no conflicts", () => {
      const orgServers: McpServer[] = [{ ...validStdioServer, id: "org-only", scope: "org" }];
      const teamServers: McpServer[] = [{ ...validStdioServer, id: "team-only", scope: "team" }];
      const projectServers: McpServer[] = [
        { ...validStdioServer, id: "project-only", scope: "project" },
      ];

      const result = resolveEffectiveServers(orgServers, teamServers, projectServers);
      expect(result).toHaveLength(3);
    });

    it("project overrides team for same id", () => {
      const teamServers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "team", name: "Team Version" },
      ];
      const projectServers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "project", name: "Project Version" },
      ];

      const result = resolveEffectiveServers([], teamServers, projectServers);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Project Version");
    });

    it("team overrides org for same id", () => {
      const orgServers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "org", name: "Org Version" },
      ];
      const teamServers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "team", name: "Team Version" },
      ];

      const result = resolveEffectiveServers(orgServers, teamServers, []);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Team Version");
    });

    it("excludes disabled servers", () => {
      const orgServers: McpServer[] = [
        { ...validStdioServer, id: "disabled", scope: "org", enabled: false },
      ];

      const result = resolveEffectiveServers(orgServers, [], []);
      expect(result).toHaveLength(0);
    });
  });

  describe("parseServerId", () => {
    it("parses namespaced id", () => {
      const result = parseServerId("acme/code-tools");
      expect(result.namespace).toBe("acme");
      expect(result.name).toBe("code-tools");
    });

    it("parses simple id", () => {
      const result = parseServerId("code-tools");
      expect(result.namespace).toBeUndefined();
      expect(result.name).toBe("code-tools");
    });
  });
});
