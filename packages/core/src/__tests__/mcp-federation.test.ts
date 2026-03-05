import { describe, expect, it } from "vitest";
import { InMemoryMcpFederationService } from "../mcp-federation.js";
import { InMemoryMcpServerRegistry } from "../mcp-registry.js";

async function createRegistry(orgId: string) {
  const registry = new InMemoryMcpServerRegistry();
  await registry.init();

  await registry.register(
    {
      id: `${orgId}/weather`,
      name: `${orgId} Weather`,
      description: `Forecast and alerts for ${orgId}`,
      transport: "http",
      url: `https://${orgId}.example.com/mcp`,
      scope: "org",
      scopeId: orgId,
      enabled: true,
      capabilities: ["weather.read", "alerts.read"],
      tools: ["forecast"],
      credentials: { key: `cred-${orgId}`, type: "api-key" },
    },
    { actor: "seed" },
  );

  await registry.register(
    {
      id: `${orgId}/private-tooling`,
      name: `${orgId} Private Tooling`,
      transport: "stdio",
      command: "node",
      args: ["private.js"],
      scope: "project",
      scopeId: `${orgId}-project-1`,
      enabled: true,
      capabilities: ["internal"],
    },
    { actor: "seed" },
  );

  return registry;
}

describe("mcp-federation", () => {
  it("allows opt-in federation export of public org servers only", async () => {
    const acmeRegistry = await createRegistry("acme");
    const service = new InMemoryMcpFederationService();

    service.registerOrganization({
      orgId: "acme",
      registry: acmeRegistry,
      sharePublicRegistry: false,
    });

    expect(await service.exportPublicRegistry("acme")).toEqual([]);

    service.setSharingConsent("acme", true);

    const exported = await service.exportPublicRegistry("acme");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.id).toBe("acme/weather");
    expect(exported[0]?.scope).toBe("org");

    const first = exported[0];
    expect(first).toBeDefined();
    if (!first) return;

    expect("credentials" in first).toBe(false);
    expect("env" in first).toBe(false);
  });

  it("keeps imported federated registries read-only", async () => {
    const acmeRegistry = await createRegistry("acme");
    const betaRegistry = await createRegistry("beta");

    const service = new InMemoryMcpFederationService();
    service.registerOrganization({
      orgId: "acme",
      registry: acmeRegistry,
      sharePublicRegistry: true,
    });
    service.registerOrganization({
      orgId: "beta",
      registry: betaRegistry,
      sharePublicRegistry: true,
    });

    await service.importFromPeer("acme", "beta");

    const initial = await service.searchMarketplace("acme", { sourceOrgIds: ["beta"] });
    expect(initial.total).toBe(1);
    expect(initial.items[0]?.id).toBe("beta/weather");

    const item = initial.items[0];
    expect(item).toBeDefined();
    if (!item) return;

    item.name = "tampered";

    const refreshed = await service.searchMarketplace("acme", { sourceOrgIds: ["beta"] });
    expect(refreshed.items[0]?.name).toBe("beta Weather");
  });

  it("supports searchable federated discovery in marketplace", async () => {
    const acmeRegistry = await createRegistry("acme");
    const betaRegistry = await createRegistry("beta");

    const service = new InMemoryMcpFederationService();
    service.registerOrganization({
      orgId: "acme",
      registry: acmeRegistry,
      sharePublicRegistry: true,
    });
    service.registerOrganization({
      orgId: "beta",
      registry: betaRegistry,
      sharePublicRegistry: true,
    });

    await service.importFromPeer("acme", "beta");

    const bySearch = await service.searchMarketplace("acme", { search: "beta weather" });
    expect(bySearch.total).toBe(1);
    expect(bySearch.items[0]?.source).toBe("federated");

    const byCapability = await service.searchMarketplace("acme", { capability: "alerts" });
    expect(byCapability.total).toBeGreaterThanOrEqual(2);
  });

  it("revokes federation consent immediately", async () => {
    const acmeRegistry = await createRegistry("acme");
    const betaRegistry = await createRegistry("beta");

    const service = new InMemoryMcpFederationService();
    service.registerOrganization({
      orgId: "acme",
      registry: acmeRegistry,
      sharePublicRegistry: true,
    });
    service.registerOrganization({
      orgId: "beta",
      registry: betaRegistry,
      sharePublicRegistry: true,
    });

    await service.importFromPeer("acme", "beta");
    expect((await service.searchMarketplace("acme", { sourceOrgIds: ["beta"] })).total).toBe(1);

    service.setSharingConsent("beta", false);

    expect((await service.searchMarketplace("acme", { sourceOrgIds: ["beta"] })).total).toBe(0);
    expect(await service.exportPublicRegistry("beta")).toEqual([]);
  });
});
