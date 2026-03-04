import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryMemoryStore,
  type MemoryContext,
  type MemoryScope,
  type MemoryStore,
} from "../memory-store.js";

describe("memory-store", () => {
  let store: MemoryStore;

  const context: MemoryContext = {
    orgId: "org-1",
    projectId: "project-1",
    sessionId: "session-1",
  };

  beforeEach(async () => {
    store = new InMemoryMemoryStore();
    await store.init();
  });

  async function write(scope: MemoryScope, id?: string, now?: Date) {
    return store.write({
      ...(id ? { id } : {}),
      content: `${scope} memory`,
      scope,
      context,
      ...(now ? { now } : {}),
    });
  }

  it("session-scope memories expire at end of session (24h TTL max)", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const record = await write("session", undefined, now);

    const expiresAt = new Date(record.expiresAt ?? "");
    expect(expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const stillVisible = await store.listByScope("session", context, {
      now: new Date("2026-01-01T23:59:59.000Z"),
    });
    expect(stillVisible).toHaveLength(1);

    const expired = await store.listByScope("session", context, {
      now: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(expired).toHaveLength(0);
  });

  it("project-scope memories persist beyond 24h", async () => {
    await write("project", "proj_mem", new Date("2026-01-01T00:00:00.000Z"));

    const later = await store.listByScope("project", context, {
      now: new Date("2026-02-10T00:00:00.000Z"),
    });
    expect(later.map((m) => m.id)).toContain("proj_mem");
  });

  it("org-scope memories persist indefinitely", async () => {
    await write("org", "org_mem", new Date("2026-01-01T00:00:00.000Z"));

    const yearsLater = await store.listByScope(
      "org",
      { orgId: "org-1", projectId: "any", sessionId: "any" },
      {
        now: new Date("2030-01-01T00:00:00.000Z"),
      },
    );

    expect(yearsLater.map((m) => m.id)).toContain("org_mem");
  });

  it("does not expose broader scope memories to narrower scope without explicit sharing", async () => {
    await write("project", "project_mem");
    await write("org", "org_mem");

    const sessionDefault = await store.listByScope("session", context);
    expect(sessionDefault).toHaveLength(0);

    const projectDefault = await store.listByScope("project", context);
    expect(projectDefault.map((m) => m.id)).toEqual(["project_mem"]);

    const sessionShared = await store.listByScope("session", context, {
      includeSharedFromBroaderScopes: true,
    });
    expect(sessionShared.map((m) => m.id)).toEqual(["project_mem", "org_mem"]);
  });

  it("keeps scope immutable at write time", async () => {
    await write("project", "immutable");

    await expect(
      store.write({
        id: "immutable",
        content: "trying to change scope",
        scope: "org",
        context,
      }),
    ).rejects.toThrow(/immutable/i);
  });

  it("restricts visibility to matching project/session/org context", async () => {
    await write("session", "session_mem");
    await write("project", "project_mem");
    await write("org", "org_mem");

    const otherSession = await store.listByScope("session", {
      orgId: "org-1",
      projectId: "project-1",
      sessionId: "session-2",
    });
    expect(otherSession).toHaveLength(0);

    const otherProject = await store.listByScope("project", {
      orgId: "org-1",
      projectId: "project-2",
      sessionId: "session-9",
    });
    expect(otherProject).toHaveLength(0);

    const otherOrg = await store.listByScope("org", {
      orgId: "org-2",
      projectId: "project-1",
      sessionId: "session-1",
    });
    expect(otherOrg).toHaveLength(0);
  });

  it("assigns a system ID when omitted and supports exact ID lookup", async () => {
    const created = await store.write({
      content: "remember this",
      scope: "project",
      context,
    });

    expect(created.id).toMatch(/^mem_/);

    const fetched = await store.getById(created.id, context);
    expect(fetched?.id).toBe(created.id);
  });

  it("supports exact key lookup for memories with explicit keys", async () => {
    await store.write({
      id: "project_with_key",
      key: "deploy-checklist",
      content: "Run migrations before deploy",
      scope: "project",
      context,
    });

    const byKey = await store.getByKey("deploy-checklist", context);
    expect(byKey?.id).toBe("project_with_key");
  });

  it("returns null for non-existent ID or key", async () => {
    expect(await store.getById("does_not_exist", context)).toBeNull();
    expect(await store.getByKey("does_not_exist", context)).toBeNull();
  });

  it("rejects duplicate keys in the same org", async () => {
    await store.write({
      id: "one",
      key: "shared-key",
      content: "first",
      scope: "project",
      context,
    });

    await expect(
      store.write({
        id: "two",
        key: "shared-key",
        content: "second",
        scope: "org",
        context,
      }),
    ).rejects.toThrow(/already in use|unique/i);
  });
});
