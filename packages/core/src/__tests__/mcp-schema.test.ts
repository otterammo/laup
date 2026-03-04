import { describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "../credential-store.js";
import {
  getEffectiveServersForScope,
  getMcpScopeChain,
  getServersAtScope,
  isServerHealthy,
  MCP_SCOPE_PRECEDENCE,
  type McpHealthState,
  type McpServer,
  mcpScopePrecedence,
  normalizeMcpServerCredentials,
  parseServerId,
  resolveEffectiveServers,
  resolveInheritedMcpServers,
  resolveMcpCredentialValue,
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
          key: "cred_123",
          type: "api-key",
          envVar: "ACME_API_KEY",
        },
      });
      expect(result.valid).toBe(true);
    });

    it("rejects plaintext credentials on top-level", () => {
      const result = validateMcpServer({
        ...validHttpServer,
        apiKey: "plain-secret",
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "apiKey")).toBe(true);
    });

    it("rejects plaintext credentials inside credentials object", () => {
      const result = validateMcpServer({
        ...validHttpServer,
        credentials: {
          apiKey: "plain-secret",
        },
      });

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "credentials.apiKey")).toBe(true);
    });

    it("validates server with version pinning", () => {
      const result = validateMcpServer({
        ...validStdioServer,
        version: {
          pinnedVersion: "1.2.3",
          constraint: ">=1.0.0 <2.0.0",
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

  describe("normalizeMcpServerCredentials", () => {
    it("migrates plaintext credential to credential-store reference", async () => {
      const store = new InMemoryCredentialStore();
      await store.init();

      const normalized = await normalizeMcpServerCredentials(
        {
          ...validHttpServer,
          credentials: {
            apiKey: "shh-secret",
            envVar: "ACME_API_KEY",
          },
        },
        {
          credentialStore: store,
          ownerId: "user-1",
          ownerType: "user",
          accessorId: "user-1",
        },
      );

      expect(normalized.credentials?.key).toMatch(/^cred_/);
      expect(normalized.credentials?.envVar).toBe("ACME_API_KEY");

      const resolved = await resolveMcpCredentialValue(normalized, store, "user-1");
      expect(resolved).toBe("shh-secret");
    });

    it("passes through existing credential references", async () => {
      const store = new InMemoryCredentialStore();
      await store.init();

      const server = {
        ...validHttpServer,
        credentials: {
          key: "cred_existing",
          type: "api-key",
        },
      };

      const normalized = await normalizeMcpServerCredentials(server, {
        credentialStore: store,
        ownerId: "user-1",
        ownerType: "user",
        accessorId: "user-1",
      });

      expect(normalized.credentials?.key).toBe("cred_existing");
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

    it("allows lower-scope disable to override higher-scope enable", () => {
      const orgServers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "org", enabled: true },
      ];
      const projectServers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "project", enabled: false },
      ];

      const result = resolveEffectiveServers(orgServers, [], projectServers);
      expect(result).toHaveLength(0);
    });
  });

  describe("scope inheritance helpers (MCP-004)", () => {
    it("includes user scope in precedence chain", () => {
      expect(MCP_SCOPE_PRECEDENCE).toEqual(["org", "team", "project", "user"]);
      expect(mcpScopePrecedence("org")).toBeLessThan(mcpScopePrecedence("team"));
      expect(mcpScopePrecedence("team")).toBeLessThan(mcpScopePrecedence("project"));
      expect(mcpScopePrecedence("project")).toBeLessThan(mcpScopePrecedence("user"));
    });

    it("returns proper chain up to target scope", () => {
      expect(getMcpScopeChain("team")).toEqual(["org", "team"]);
      expect(getMcpScopeChain("user")).toEqual(["org", "team", "project", "user"]);
    });

    it("resolves scoped inheritance using context IDs", () => {
      const servers: McpServer[] = [
        { ...validStdioServer, id: "org-only", scope: "org", scopeId: "acme" },
        { ...validStdioServer, id: "team-only", scope: "team", scopeId: "team-a" },
        { ...validStdioServer, id: "project-only", scope: "project", scopeId: "proj-1" },
        { ...validStdioServer, id: "user-only", scope: "user", scopeId: "user-1" },
      ];

      const result = resolveInheritedMcpServers(servers, "user", {
        orgId: "acme",
        teamId: "team-a",
        projectId: "proj-1",
        userId: "user-1",
      });

      expect(result.map((s) => s.id).sort()).toEqual([
        "org-only",
        "project-only",
        "team-only",
        "user-only",
      ]);
    });

    it("supports deterministic same-scope tie-break using updatedAt", () => {
      const servers: McpServer[] = [
        {
          ...validStdioServer,
          id: "shared",
          scope: "team",
          name: "Older Team Version",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          ...validStdioServer,
          id: "shared",
          scope: "team",
          name: "Newer Team Version",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      ];

      const result = resolveInheritedMcpServers(servers, "project", {});
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("Newer Team Version");
    });

    it("integration helper returns effective view for scope", () => {
      const servers: McpServer[] = [
        { ...validStdioServer, id: "shared", scope: "org", name: "Org Version" },
        { ...validStdioServer, id: "shared", scope: "project", name: "Project Version" },
      ];

      const effective = getEffectiveServersForScope(servers, "project", {});
      expect(effective).toHaveLength(1);
      expect(effective[0]?.name).toBe("Project Version");
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
