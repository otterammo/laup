import { describe, expect, it } from "vitest";
import { InMemoryMemoryStore, type MemoryStore } from "../memory-store.js";
import { DefaultZepContextResolver, ZepMemoryClient } from "../memory-zep.js";

describe("ZepMemoryClient", () => {
  it("supports session model via bound session client", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new ZepMemoryClient(
      store as unknown as MemoryStore,
      new DefaultZepContextResolver({ orgId: "org-1", projectId: "project-1" }),
    );

    const session = client.session("session-1");
    const added = await session.add_memory("Remember onboarding checklist", { topic: "ops" });

    expect(added).toHaveLength(1);
    expect(added[0]?.content).toBe("Remember onboarding checklist");
    expect(added[0]?.metadata).toMatchObject({ source: "zep", role: "user", topic: "ops" });

    const memories = await session.get_memory();
    expect(Array.isArray(memories)).toBe(true);
    expect(memories).toHaveLength(1);
  });

  it("supports add_memory/search_memory/get_memory signatures", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new ZepMemoryClient(
      store as unknown as MemoryStore,
      new DefaultZepContextResolver({ orgId: "org-1", projectId: "project-1" }),
    );

    const added = await client.add_memory({
      session_id: "session-2",
      memory: [
        { role: "user", content: "Deploy service after smoke tests", metadata: { env: "prod" } },
        { role: "assistant", content: "Rollback playbook is updated", metadata: { env: "prod" } },
      ],
      metadata: { app: "chat" },
    });

    expect(added).toHaveLength(2);

    const searchResults = await client.search_memory({
      session_id: "session-2",
      query: "deploy smoke",
      filters: { env: "prod" },
      limit: 1,
    });

    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]?.content).toContain("Deploy");
    expect(searchResults[0]?.score).toBeGreaterThan(0);

    const firstAdded = added[0];
    expect(firstAdded).toBeDefined();

    const one = await client.get_memory({
      session_id: "session-2",
      memory_id: firstAdded?.uuid ?? "",
    });

    expect(one).not.toBeNull();
    expect(Array.isArray(one)).toBe(false);
    expect((one as { uuid: string }).uuid).toBe(firstAdded?.uuid);
  });

  it("isolates memories by session id", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new ZepMemoryClient(
      store as unknown as MemoryStore,
      new DefaultZepContextResolver({ orgId: "org-1", projectId: "project-1" }),
    );

    await client.add_memory({
      session_id: "session-a",
      memory: "Session A memory",
    });

    await client.add_memory({
      session_id: "session-b",
      memory: "Session B memory",
    });

    const aMemories = await client.get_memory({ session_id: "session-a" });
    const bMemories = await client.get_memory({ session_id: "session-b" });

    expect(aMemories).toHaveLength(1);
    expect((aMemories as { content: string }[])[0]?.content).toBe("Session A memory");
    expect(bMemories).toHaveLength(1);
    expect((bMemories as { content: string }[])[0]?.content).toBe("Session B memory");
  });
});
