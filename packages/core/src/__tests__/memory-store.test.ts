import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStorage } from "../audit-storage.js";
import {
  InMemoryMemoryStore,
  MemoryAccessDeniedError,
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

  it("returns access denied (403) when reading memory id outside allowed context", async () => {
    await store.write({
      id: "restricted-project-memory",
      content: "Sensitive project details",
      scope: "project",
      context,
    });

    await expect(
      store.getById("restricted-project-memory", {
        orgId: "org-1",
        projectId: "project-2",
        sessionId: "session-1",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      store.getById("restricted-project-memory", {
        orgId: "org-1",
        projectId: "project-2",
        sessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  });

  it("returns access denied (403) when reading memory key outside allowed context", async () => {
    await store.write({
      id: "restricted-key-memory",
      key: "private-checklist",
      content: "Private checklist",
      scope: "project",
      context,
    });

    await expect(
      store.getByKey("private-checklist", {
        orgId: "org-1",
        projectId: "project-2",
        sessionId: "session-9",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
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

  it("uses last-write-wins by default for duplicate keys", async () => {
    await store.write({
      id: "one",
      key: "shared-key",
      content: "first",
      scope: "project",
      context,
    });

    const written = await store.write({
      id: "two",
      key: "shared-key",
      content: "second",
      scope: "project",
      context,
    });

    expect(written.id).toBe("one");
    expect((await store.getByKey("shared-key", context))?.content).toBe("second");
  });

  it("supports first-write-wins strategy", async () => {
    const firstWinsStore = new InMemoryMemoryStore({
      conflictResolutionStrategy: "first-write-wins",
    });
    await firstWinsStore.init();

    await firstWinsStore.write({
      id: "one",
      key: "shared-key",
      content: "first",
      scope: "project",
      context,
    });

    await expect(
      firstWinsStore.write({
        id: "two",
        key: "shared-key",
        content: "second",
        scope: "project",
        context,
      }),
    ).rejects.toThrow(/already in use/i);
  });

  it("supports manual-review strategy and conflict queue", async () => {
    const manualStore = new InMemoryMemoryStore({
      conflictResolutionStrategy: "manual-review",
    });
    await manualStore.init();

    await manualStore.write({
      id: "one",
      key: "shared-key",
      content: "first",
      scope: "project",
      context,
    });

    await expect(
      manualStore.write({
        id: "two",
        key: "shared-key",
        content: "second",
        scope: "project",
        context,
      }),
    ).rejects.toThrow(/manual review/i);

    const pending = await manualStore.listConflicts(context, { status: "pending" });
    expect(pending).toHaveLength(1);

    await manualStore.resolveConflict(pending[0]?.id ?? "", "accept-incoming", context);
    expect((await manualStore.getByKey("shared-key", context))?.content).toBe("second");
  });

  it("allows per-project conflict strategy overrides", async () => {
    const scopedStore = new InMemoryMemoryStore({
      conflictResolutionStrategy: "last-write-wins",
      conflictResolutionByProject: (ctx) =>
        ctx.projectId === "project-strict" ? "first-write-wins" : undefined,
    });
    await scopedStore.init();

    const strictContext: MemoryContext = {
      orgId: "org-1",
      projectId: "project-strict",
      sessionId: "session-1",
    };

    await scopedStore.write({
      id: "strict-1",
      key: "dup",
      content: "first",
      scope: "project",
      context: strictContext,
    });

    await expect(
      scopedStore.write({
        id: "strict-2",
        key: "dup",
        content: "second",
        scope: "project",
        context: strictContext,
      }),
    ).rejects.toThrow(/already in use/i);
  });

  it("still rejects duplicate keys across different scopes", async () => {
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
    ).rejects.toThrow(/different scope|already in use|unique/i);
  });

  it("supports cross-tool reads in the same scope and audits them", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const crossToolStore = new InMemoryMemoryStore({
      auditStorage,
      auditActor: "tester",
    });
    await crossToolStore.init();

    await crossToolStore.write({
      id: "cross-tool-memory",
      content: "Shared deployment context",
      scope: "project",
      context,
      sourceToolId: "claude-code",
    });

    const readByCursor = await crossToolStore.listByScope("project", context, {
      requestingToolId: "cursor",
    });

    expect(readByCursor).toHaveLength(1);
    expect(readByCursor[0]?.sourceToolId).toBe("claude-code");

    await crossToolStore.getById("cross-tool-memory", context, {
      requestingToolId: "cursor",
    });

    const page = await auditStorage.query({ category: "memory", actor: "tester" }, 100, 0);
    const crossToolAudit = page.entries.find(
      (entry) =>
        entry.action === "memory.getById" &&
        (entry.metadata?.["crossToolRead"] as boolean | undefined) === true,
    );

    expect(crossToolAudit).toBeDefined();
    expect(crossToolAudit?.metadata?.["requestingToolId"]).toBe("cursor");
    expect(crossToolAudit?.metadata?.["sourceToolId"]).toBe("claude-code");
  });

  it("defaults sourceToolId to unknown when omitted", async () => {
    const record = await store.write({
      id: "unknown-source",
      content: "no source provided",
      scope: "project",
      context,
    });

    expect(record.sourceToolId).toBe("unknown");
  });

  it("exports memory in JSON with metadata fields and filters", async () => {
    await store.write({
      id: "exp-1",
      key: "deploy-checklist",
      content: "Run migrations",
      scope: "project",
      context,
      tags: ["ops", "release"],
      metadata: { tags: ["ops", "release"], priority: "high" },
      sourceToolId: "cursor",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    await store.write({
      id: "exp-2",
      content: "Personal preference",
      scope: "session",
      context,
      tags: ["personal"],
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    await store.getById("exp-1", context);

    const page = await store.export(context, {
      format: "json",
      scope: "project",
      tags: ["ops"],
      startTime: new Date("2026-01-01T00:00:00.000Z"),
      endTime: new Date("2026-01-03T00:00:00.000Z"),
    });

    const rows = JSON.parse(page.data) as Array<Record<string, unknown>>;
    expect(page.total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe("exp-1");
    expect(rows[0]?.["scope"]).toBe("project");
    expect(rows[0]?.["tags"]).toContain("ops");
    expect(rows[0]?.["sourceToolId"]).toBe("cursor");
    expect(rows[0]?.["createdAt"]).toBe("2026-01-01T00:00:00.000Z");
    expect(rows[0]?.["lastAccessedAt"]).toBeTruthy();
  });

  it("exports memory in CSV with pagination", async () => {
    await store.write({ id: "csv-1", content: "one", scope: "project", context });
    await store.write({ id: "csv-2", content: "two", scope: "project", context });

    const page = await store.export(context, {
      format: "csv",
      scope: "project",
      limit: 1,
      offset: 0,
    });
    const lines = page.data.split("\n");

    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(lines[0]).toContain("id,key,content,scope,tags,sourceToolId");
    expect(lines[1]).toContain("csv-1");
  });

  it("records an audit trail for memory operations", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const auditedStore = new InMemoryMemoryStore({
      auditStorage,
      auditActor: "tester",
    });
    await auditedStore.init();

    await auditedStore.write({
      id: "audited-memory",
      key: "checklist",
      content: "Run post-deploy smoke checks",
      scope: "project",
      context,
    });

    await auditedStore.listByScope("project", context);
    await auditedStore.getById("audited-memory", context);
    await auditedStore.getByKey("checklist", context);
    await expect(
      auditedStore.write({
        id: "audited-memory-2",
        key: "checklist",
        content: "Conflicting write",
        scope: "project",
        context,
      }),
    ).resolves.toBeDefined();

    await auditedStore.pruneExpired(new Date("2030-01-01T00:00:00.000Z"));

    const page = await auditStorage.query({ category: "memory", actor: "tester" }, 50, 0);
    const actions = page.entries.map((entry) => entry.action);

    expect(actions).toContain("memory.init");
    expect(actions).toContain("memory.write");
    expect(actions).toContain("memory.listByScope");
    expect(actions).toContain("memory.getById");
    expect(actions).toContain("memory.getByKey");
    expect(actions).toContain("memory.pruneExpired");
    expect(actions).toContain("memory.conflict");
  });
});
