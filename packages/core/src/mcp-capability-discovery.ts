import { z } from "zod";
import type { McpRegistryOperationOptions, McpServerRegistry } from "./mcp-registry.js";
import type { McpServer } from "./mcp-schema.js";

export const McpCapabilityManifestSchema = z
  .object({
    capabilities: z.array(z.string()).default([]),
    tools: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type McpCapabilityManifest = z.infer<typeof McpCapabilityManifestSchema>;

export interface McpCapabilityDiscoveryClient {
  discover(server: McpServer): Promise<McpCapabilityManifest>;
}

export const McpCapabilityDashboardServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.string(),
  scopeId: z.string().optional(),
  capabilities: z.array(z.string()),
  refreshedAt: z.string().optional(),
  status: z.enum(["ready", "stale", "error"]),
  error: z.string().optional(),
});

export type McpCapabilityDashboardServer = z.infer<typeof McpCapabilityDashboardServerSchema>;

export const McpCapabilityDashboardSnapshotSchema = z.object({
  generatedAt: z.string(),
  totalServers: z.number().int().nonnegative(),
  serversWithCapabilities: z.number().int().nonnegative(),
  uniqueCapabilities: z.array(z.string()),
  servers: z.array(McpCapabilityDashboardServerSchema),
});

export type McpCapabilityDashboardSnapshot = z.infer<typeof McpCapabilityDashboardSnapshotSchema>;

export interface McpCapabilityQueryMatch {
  capability: string;
  servers: string[];
}

export interface McpCapabilityQueryResult {
  query: string;
  matches: McpCapabilityQueryMatch[];
  suggestedCapabilities: string[];
}

export interface McpCapabilityDiscoveryConfig {
  refreshIntervalMs?: number;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  registryOptions?: McpRegistryOperationOptions;
}

interface DiscoveryState {
  refreshedAt?: string;
  error?: string;
  updatedAt?: string;
}

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000;

export class McpCapabilityDiscoveryService {
  private readonly now: () => Date;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly refreshIntervalMs: number;
  private readonly registryOptions: McpRegistryOperationOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly state = new Map<string, DiscoveryState>();

  constructor(
    private readonly registry: McpServerRegistry,
    private readonly client: McpCapabilityDiscoveryClient,
    config: McpCapabilityDiscoveryConfig = {},
  ) {
    this.now = config.now ?? (() => new Date());
    this.setIntervalFn = config.setIntervalFn ?? setInterval;
    this.clearIntervalFn = config.clearIntervalFn ?? clearInterval;
    this.refreshIntervalMs = config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.registryOptions = config.registryOptions ?? {
      actor: "system:mcp-capability-discovery",
      reason: "Capability manifest refresh",
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.setIntervalFn(() => {
      void this.refreshAll(true);
    }, this.refreshIntervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  async refreshAll(force = false): Promise<void> {
    const servers = await this.registry.list();
    const activeKeys = new Set(servers.map((server) => this.serverKey(server)));

    for (const key of this.state.keys()) {
      if (!activeKeys.has(key)) {
        this.state.delete(key);
      }
    }

    for (const server of servers) {
      if (!server.enabled) continue;

      const key = this.serverKey(server);
      const currentState = this.state.get(key);

      if (
        !force &&
        currentState?.updatedAt === server.updatedAt &&
        currentState?.error === undefined
      ) {
        continue;
      }

      await this.refreshServer(server);
    }
  }

  async refreshServer(server: McpServer): Promise<void> {
    const key = this.serverKey(server);

    try {
      const manifest = McpCapabilityManifestSchema.parse(await this.client.discover(server));
      const capabilities = normalizeCapabilities(manifest.capabilities);

      await this.registry.update(
        {
          ...server,
          capabilities,
          ...(manifest.tools ? { tools: manifest.tools } : {}),
        },
        this.registryOptions,
      );

      this.state.set(key, {
        refreshedAt: this.now().toISOString(),
        ...(server.updatedAt ? { updatedAt: server.updatedAt } : {}),
      });
    } catch (error) {
      this.state.set(key, {
        refreshedAt: this.now().toISOString(),
        ...(server.updatedAt ? { updatedAt: server.updatedAt } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async dashboardSnapshot(): Promise<McpCapabilityDashboardSnapshot> {
    const servers = await this.registry.list();
    const uniqueCapabilities = new Set<string>();

    const view = servers.map((server) => {
      for (const capability of server.capabilities ?? []) {
        uniqueCapabilities.add(capability);
      }

      const state = this.state.get(this.serverKey(server));
      return {
        id: server.id,
        name: server.name,
        scope: server.scope,
        ...(server.scopeId ? { scopeId: server.scopeId } : {}),
        capabilities: [...(server.capabilities ?? [])],
        ...(state?.refreshedAt ? { refreshedAt: state.refreshedAt } : {}),
        status: state?.error ? "error" : state?.refreshedAt ? "ready" : "stale",
        ...(state?.error ? { error: state.error } : {}),
      } satisfies McpCapabilityDashboardServer;
    });

    return {
      generatedAt: this.now().toISOString(),
      totalServers: servers.length,
      serversWithCapabilities: servers.filter((server) => (server.capabilities?.length ?? 0) > 0)
        .length,
      uniqueCapabilities: [...uniqueCapabilities].sort(),
      servers: view,
    };
  }

  async queryByNaturalLanguage(query: string): Promise<McpCapabilityQueryResult> {
    const servers = await this.registry.list();
    const normalizedQuery = normalizeText(query);
    const queryTokens = new Set(tokenize(normalizedQuery));

    const serverByCapability = new Map<string, Set<string>>();

    for (const server of servers) {
      for (const capability of server.capabilities ?? []) {
        const normalizedCapability = normalizeText(capability);
        if (!serverByCapability.has(normalizedCapability)) {
          serverByCapability.set(normalizedCapability, new Set());
        }
        serverByCapability.get(normalizedCapability)?.add(server.id);
      }
    }

    const matches: McpCapabilityQueryMatch[] = [];

    for (const [capability, ids] of serverByCapability.entries()) {
      const capabilityTokens = tokenize(capability);
      const intersects =
        capability.includes(normalizedQuery) ||
        capabilityTokens.some((token) => queryTokens.has(token));
      if (!intersects) continue;

      matches.push({
        capability,
        servers: [...ids].sort(),
      });
    }

    matches.sort((a, b) => a.capability.localeCompare(b.capability));

    return {
      query,
      matches,
      suggestedCapabilities: matches.slice(0, 5).map((entry) => entry.capability),
    };
  }

  private serverKey(server: Pick<McpServer, "id" | "scope" | "scopeId">): string {
    return `${server.scope}:${server.scopeId ?? ""}:${server.id}`;
  }
}

function normalizeCapabilities(capabilities: string[]): string[] {
  return [
    ...new Set(capabilities.map((capability) => normalizeText(capability)).filter(Boolean)),
  ].sort();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter((token) => token.length > 0);
}
