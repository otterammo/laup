import type { McpServerRegistry } from "./mcp-registry.js";
import type { McpServer } from "./mcp-schema.js";

export interface McpFederationOrganizationConfig {
  /** Unique organization ID. */
  orgId: string;

  /** Local MCP registry for this organization. */
  registry: McpServerRegistry;

  /** Whether this org consents to publish its public MCP registry to peers. */
  sharePublicRegistry?: boolean;
}

export interface McpFederationQuery {
  search?: string;
  capability?: string;
  sourceOrgIds?: string[];
  limit?: number;
  offset?: number;
}

export interface FederatedMcpServerView {
  id: string;
  name: string;
  description?: string;
  transport: McpServer["transport"];
  url?: string;
  command?: string;
  args?: string[];
  scope: McpServer["scope"];
  scopeId?: string;
  tools: string[];
  capabilities: string[];
  enabled: boolean;
  registeredAt?: string;
  updatedAt?: string;
  sourceOrgId: string;
  source: "local" | "federated";
}

export interface FederatedMcpMarketplacePage {
  total: number;
  limit: number;
  offset: number;
  items: FederatedMcpServerView[];
}

interface OrganizationState {
  registry: McpServerRegistry;
  sharePublicRegistry: boolean;
}

/**
 * In-memory MCP federation index (MCP-010).
 *
 * - Organizations can explicitly opt into outbound sharing
 * - Imported federated registries are read-only views
 * - Federated/public MCP server discovery is searchable
 * - Federation consent can be revoked at any time
 */
export class InMemoryMcpFederationService {
  private readonly organizations = new Map<string, OrganizationState>();

  private readonly imported = new Map<string, Map<string, FederatedMcpServerView[]>>();

  registerOrganization(config: McpFederationOrganizationConfig): void {
    this.organizations.set(config.orgId, {
      registry: config.registry,
      sharePublicRegistry: config.sharePublicRegistry ?? false,
    });
  }

  setSharingConsent(orgId: string, sharePublicRegistry: boolean): void {
    const org = this.organizations.get(orgId);
    if (!org) {
      throw new Error(`Unknown organization ${orgId}`);
    }

    org.sharePublicRegistry = sharePublicRegistry;

    if (!sharePublicRegistry) {
      for (const viewerImports of this.imported.values()) {
        viewerImports.delete(orgId);
      }
    }
  }

  async exportPublicRegistry(orgId: string): Promise<FederatedMcpServerView[]> {
    const org = this.organizations.get(orgId);
    if (!org) {
      throw new Error(`Unknown organization ${orgId}`);
    }

    if (!org.sharePublicRegistry) {
      return [];
    }

    const servers = await org.registry.list();
    return servers
      .filter((server) => this.isPublicServer(server))
      .map((server) => this.toView(server, orgId, "local"));
  }

  async importFromPeer(viewerOrgId: string, sourceOrgId: string): Promise<void> {
    if (viewerOrgId === sourceOrgId) return;

    const snapshot = await this.exportPublicRegistry(sourceOrgId);
    if (!this.imported.has(viewerOrgId)) {
      this.imported.set(viewerOrgId, new Map());
    }

    this.imported.get(viewerOrgId)?.set(
      sourceOrgId,
      snapshot.map((item) => ({ ...structuredClone(item), source: "federated" as const })),
    );
  }

  revokeImportedPeer(viewerOrgId: string, sourceOrgId: string): void {
    this.imported.get(viewerOrgId)?.delete(sourceOrgId);
  }

  async searchMarketplace(
    viewerOrgId: string,
    query: McpFederationQuery = {},
  ): Promise<FederatedMcpMarketplacePage> {
    const localOrg = this.organizations.get(viewerOrgId);
    if (!localOrg) {
      throw new Error(`Unknown organization ${viewerOrgId}`);
    }

    const localServers = (await localOrg.registry.list())
      .filter((server) => this.isPublicServer(server))
      .map((server) => this.toView(server, viewerOrgId, "local"));

    const remoteServers = Array.from(this.imported.get(viewerOrgId)?.values() ?? []).flatMap(
      (items) => items.map((item) => structuredClone(item)),
    );

    const all = [...localServers, ...remoteServers];

    const filtered = all.filter((item) => {
      if (query.sourceOrgIds && query.sourceOrgIds.length > 0) {
        if (!query.sourceOrgIds.includes(item.sourceOrgId)) return false;
      }

      if (query.capability) {
        const expected = normalize(query.capability);
        if (!item.capabilities.some((capability) => normalize(capability).includes(expected))) {
          return false;
        }
      }

      if (query.search) {
        const haystack = [
          item.id,
          item.name,
          item.description ?? "",
          ...item.capabilities,
          ...item.tools,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalize(query.search))) return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      const orgCmp = a.sourceOrgId.localeCompare(b.sourceOrgId);
      if (orgCmp !== 0) return orgCmp;
      return a.id.localeCompare(b.id);
    });

    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, query.limit ?? 25);

    return {
      total: filtered.length,
      offset,
      limit,
      items: filtered.slice(offset, offset + limit),
    };
  }

  private isPublicServer(server: McpServer): boolean {
    return server.enabled && server.scope === "org";
  }

  private toView(
    server: McpServer,
    sourceOrgId: string,
    source: FederatedMcpServerView["source"],
  ): FederatedMcpServerView {
    return {
      id: server.id,
      name: server.name,
      ...(server.description ? { description: server.description } : {}),
      transport: server.transport,
      ...(server.url ? { url: server.url } : {}),
      ...(server.command ? { command: server.command } : {}),
      ...(server.args ? { args: [...server.args] } : {}),
      scope: server.scope,
      ...(server.scopeId ? { scopeId: server.scopeId } : {}),
      tools: [...(server.tools ?? [])],
      capabilities: [...(server.capabilities ?? [])],
      enabled: server.enabled,
      ...(server.registeredAt ? { registeredAt: server.registeredAt } : {}),
      ...(server.updatedAt ? { updatedAt: server.updatedAt } : {}),
      sourceOrgId,
      source,
    };
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
