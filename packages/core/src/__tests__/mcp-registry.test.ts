import { describe, expect, it } from "vitest";
import { InMemoryMcpServerRegistry } from "../mcp-registry.js";

describe("mcp-registry", () => {
  const baseServer = {
    id: "org/weather",
    name: "Weather",
    transport: "http" as const,
    url: "https://example.com/mcp",
    scope: "project" as const,
    scopeId: "proj-1",
    enabled: true,
  };

  it("records audit trail for registry operations", async () => {
    const registry = new InMemoryMcpServerRegistry();
    await registry.init();

    await registry.register(baseServer, { actor: "alice" });
    await registry.update({ ...baseServer, name: "Weather v2" }, { actor: "alice" });
    await registry.disable(baseServer.id, { actor: "bob" }, "project", "proj-1");
    await registry.enable(baseServer.id, { actor: "bob" }, "project", "proj-1");
    await registry.rotateCredentials(
      baseServer.id,
      { key: "cred-2", type: "api-key" },
      { actor: "carol" },
      "project",
      "proj-1",
    );
    await registry.deregister(baseServer.id, { actor: "alice" }, "project", "proj-1");

    const entries = await registry.queryAudit();
    expect(entries).toHaveLength(6);
    expect(entries.map((entry) => entry.operation)).toEqual([
      "register",
      "update",
      "disable",
      "enable",
      "credential-rotate",
      "deregister",
    ]);

    for (const entry of entries) {
      expect(entry.serverId).toBe(baseServer.id);
      expect(entry.scope).toBe("project");
      expect(entry.scopeId).toBe("proj-1");
      expect(entry.actor.length).toBeGreaterThan(0);
      expect(typeof entry.timestamp).toBe("string");
    }
  });

  it("supports audit filtering and immutable records", async () => {
    const registry = new InMemoryMcpServerRegistry();
    await registry.init();

    await registry.register(baseServer, { actor: "alice" });
    await registry.update({ ...baseServer, name: "Weather v2" }, { actor: "bob" });

    const byActor = await registry.queryAudit({ actor: "bob" });
    expect(byActor).toHaveLength(1);
    expect(byActor[0]?.operation).toBe("update");

    const byOperation = await registry.queryAudit({ operation: "register" });
    expect(byOperation).toHaveLength(1);

    const byServer = await registry.queryAudit({ serverId: baseServer.id });
    expect(byServer).toHaveLength(2);

    const dateStart = new Date(Date.now() - 60_000).toISOString();
    const dateEnd = new Date(Date.now() + 60_000).toISOString();
    const byDate = await registry.queryAudit({ startTime: dateStart, endTime: dateEnd });
    expect(byDate).toHaveLength(2);

    const first = byServer[0];
    expect(first).toBeDefined();
    if (!first) return;

    first.actor = "mallory";

    const freshRead = await registry.queryAudit({ operation: "register" });
    expect(freshRead[0]?.actor).toBe("alice");
  });
});
