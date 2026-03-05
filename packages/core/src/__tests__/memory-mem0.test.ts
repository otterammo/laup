import { describe, expect, it } from "vitest";
import { DefaultMem0ContextResolver, Mem0MemoryClient } from "../memory-mem0.js";
import { InMemoryMemoryStore, type MemoryStore } from "../memory-store.js";

describe("Mem0MemoryClient", () => {
  it("adds memories from string input with Mem0 metadata", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new Mem0MemoryClient(
      store as unknown as MemoryStore,
      new DefaultMem0ContextResolver({ orgId: "org-default" }),
    );

    const records = await client.add("Remember this", {
      user_id: "org-1",
      metadata: { topic: "notes" },
    });

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.content).toBe("Remember this");
    expect(record?.sourceToolId).toBe("mem0");
    expect(record?.metadata).toMatchObject({ source: "mem0", role: "user", topic: "notes" });
  });

  it("searches memories using mapped Mem0 context, filters, and limit", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new Mem0MemoryClient(
      store as unknown as MemoryStore,
      new DefaultMem0ContextResolver({ orgId: "org-default" }),
    );

    await client.add(
      [
        { role: "user", content: "Deploy to production after review" },
        { role: "assistant", content: "Staging checklist is complete" },
      ],
      {
        user_id: "org-1",
        agent_id: "project-1",
        run_id: "session-1",
        metadata: { env: "prod" },
      },
    );

    await client.add("Deploy docs first", {
      user_id: "org-1",
      agent_id: "project-1",
      run_id: "session-1",
      metadata: { env: "staging" },
    });

    const results = await client.search({
      query: "deploy production",
      user_id: "org-1",
      agent_id: "project-1",
      run_id: "session-1",
      filters: { env: "prod" },
      limit: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.memory).toContain("Deploy");
    expect(results[0]?.metadata).toMatchObject({ env: "prod" });
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("supports category/tags filters for retrieval", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new Mem0MemoryClient(
      store as unknown as MemoryStore,
      new DefaultMem0ContextResolver({ orgId: "org-default" }),
    );

    await client.add("Deploy release note", {
      user_id: "org-1",
      metadata: { env: "prod", tags: ["release", "ops"], category: "runbook" },
    });
    await client.add("Personal todo", {
      user_id: "org-1",
      metadata: { env: "prod", tags: ["personal"], category: "notes" },
    });

    const results = await client.search({
      query: "deploy",
      user_id: "org-1",
      filters: { category: "runbook", tags: ["release"] },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.memory).toContain("Deploy");
  });

  it("deletes memories by id with either string id or params object", async () => {
    const store = new InMemoryMemoryStore();
    await store.init();

    const client = new Mem0MemoryClient(
      store as unknown as MemoryStore,
      new DefaultMem0ContextResolver({ orgId: "org-1" }),
    );

    const records = await client.add("Delete me", { user_id: "org-1" });
    const record = records[0];
    expect(record).toBeDefined();

    const deletedViaString = await client.delete(record?.id ?? "");
    expect(deletedViaString).toEqual({ id: record?.id, deleted: true });

    const records2 = await client.add("Delete me too", { user_id: "org-1" });
    const record2 = records2[0];
    expect(record2).toBeDefined();

    const deletedViaParams = await client.delete({
      memory_id: record2?.id ?? "",
      user_id: "org-1",
    });
    expect(deletedViaParams).toEqual({ id: record2?.id, deleted: true });
  });
});
