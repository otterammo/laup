import { beforeEach, describe, expect, it } from "vitest";
import type { LlmUsage, UsageEvent } from "../cost-schema.js";
import { InMemoryUsageStorage, type UsageStorage } from "../usage-storage.js";

describe("usage-storage", () => {
  let storage: UsageStorage;

  const makeLlmData = (overrides: Partial<LlmUsage> = {}): LlmUsage => ({
    provider: "openai",
    model: "gpt-4",
    inputTokens: 100,
    outputTokens: 50,
    success: true,
    ...overrides,
  });

  const makeEvent = (overrides: Partial<UsageEvent> = {}): UsageEvent =>
    ({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: "llm-call",
      timestamp: new Date().toISOString(),
      attribution: {
        userId: "user-1",
        teamId: "team-1",
        projectId: "project-1",
        orgId: "org-1",
      },
      data: makeLlmData(),
      ...overrides,
    }) as UsageEvent;

  beforeEach(async () => {
    storage = new InMemoryUsageStorage();
    await storage.init();
  });

  describe("store", () => {
    it("stores an event and returns an id", async () => {
      const event = makeEvent();
      const id = await storage.store(event);

      expect(id).toMatch(/^evt_/);
    });

    it("increments count after storing", async () => {
      expect(await storage.count()).toBe(0);

      await storage.store(makeEvent());
      expect(await storage.count()).toBe(1);

      await storage.store(makeEvent());
      expect(await storage.count()).toBe(2);
    });
  });

  describe("storeBatch", () => {
    it("stores multiple events", async () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      const ids = await storage.storeBatch(events);

      expect(ids).toHaveLength(3);
      expect(await storage.count()).toBe(3);
    });

    it("returns unique ids", async () => {
      const events = [makeEvent(), makeEvent()];
      const ids = await storage.storeBatch(events);

      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("query", () => {
    it("returns all events without filter", async () => {
      await storage.storeBatch([makeEvent(), makeEvent()]);

      const result = await storage.query({});
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("filters by userId", async () => {
      await storage.store(makeEvent({ attribution: { userId: "user-1", orgId: "org-1" } }));
      await storage.store(makeEvent({ attribution: { userId: "user-2", orgId: "org-1" } }));

      const result = await storage.query({ userId: "user-1" });
      expect(result.data).toHaveLength(1);
    });

    it("filters by projectId", async () => {
      await storage.store(
        makeEvent({ attribution: { userId: "u", projectId: "p1", orgId: "org-1" } }),
      );
      await storage.store(
        makeEvent({ attribution: { userId: "u", projectId: "p2", orgId: "org-1" } }),
      );

      const result = await storage.query({ projectId: "p1" });
      expect(result.data).toHaveLength(1);
    });

    it("filters by time range", async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await storage.store(makeEvent({ timestamp: yesterday.toISOString() }));
      await storage.store(makeEvent({ timestamp: now.toISOString() }));

      const result = await storage.query({
        startTime: new Date(now.getTime() - 1000),
        endTime: tomorrow,
      });
      expect(result.data).toHaveLength(1);
    });

    it("supports pagination", async () => {
      await storage.storeBatch([makeEvent(), makeEvent(), makeEvent(), makeEvent(), makeEvent()]);

      const page1 = await storage.query({}, { limit: 2, offset: 0 });
      expect(page1.data).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await storage.query({}, { limit: 2, offset: 2 });
      expect(page2.data).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await storage.query({}, { limit: 2, offset: 4 });
      expect(page3.data).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  describe("aggregate", () => {
    it("aggregates by day", async () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      await storage.store(makeEvent({ timestamp: today.toISOString() }));
      await storage.store(makeEvent({ timestamp: today.toISOString() }));
      await storage.store(makeEvent({ timestamp: yesterday.toISOString() }));

      const result = await storage.aggregate({}, "day");
      expect(result).toHaveLength(2);
    });

    it("sums tokens", async () => {
      const now = new Date().toISOString();
      await storage.store(
        makeEvent({
          timestamp: now,
          data: makeLlmData({ inputTokens: 100, outputTokens: 50 }),
        }),
      );
      await storage.store(
        makeEvent({
          timestamp: now,
          data: makeLlmData({ inputTokens: 200, outputTokens: 100 }),
        }),
      );

      const result = await storage.aggregate({}, "day");
      expect(result[0]?.totalTokens).toBe(450);
      expect(result[0]?.inputTokens).toBe(300);
      expect(result[0]?.outputTokens).toBe(150);
      expect(result[0]?.eventCount).toBe(2);
    });
  });

  describe("summarize", () => {
    it("groups by user", async () => {
      await storage.store(makeEvent({ attribution: { userId: "user-1", orgId: "org-1" } }));
      await storage.store(makeEvent({ attribution: { userId: "user-1", orgId: "org-1" } }));
      await storage.store(
        makeEvent({
          attribution: { userId: "user-2", orgId: "org-1" },
          data: makeLlmData({ inputTokens: 500, outputTokens: 500 }),
        }),
      );

      const result = await storage.summarize({}, "userId");
      expect(result).toHaveLength(2);

      // user-2 has more tokens, should be first
      const user2 = result.find((s) => s.value === "user-2");
      expect(user2?.totalTokens).toBe(1000);
      expect(user2?.eventCount).toBe(1);
    });

    it("sorts by tokens descending", async () => {
      await storage.store(
        makeEvent({
          attribution: { userId: "small", orgId: "org-1" },
          data: makeLlmData({ inputTokens: 10, outputTokens: 10 }),
        }),
      );
      await storage.store(
        makeEvent({
          attribution: { userId: "large", orgId: "org-1" },
          data: makeLlmData({ inputTokens: 1000, outputTokens: 1000 }),
        }),
      );

      const result = await storage.summarize({}, "userId");
      expect(result[0]?.value).toBe("large");
    });

    it("supports multi-dimension summaries", async () => {
      await storage.store(
        makeEvent({
          attribution: {
            developerId: "dev-1",
            teamId: "team-a",
            projectId: "project-a",
            skillId: "skill-a",
            orgId: "org-1",
          },
          data: makeLlmData({ inputTokens: 100, outputTokens: 100 }),
        }),
      );
      await storage.store(
        makeEvent({
          attribution: {
            developerId: "dev-1",
            teamId: "team-a",
            projectId: "project-a",
            skillId: "skill-a",
            orgId: "org-1",
          },
          data: makeLlmData({ inputTokens: 50, outputTokens: 50 }),
        }),
      );

      const result = await storage.summarizeByDimensions({}, [
        "developerId",
        "teamId",
        "projectId",
        "skillId",
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]?.dimensions["developerId"]).toBe("dev-1");
      expect(result[0]?.totalTokens).toBe(300);
      expect(result[0]?.eventCount).toBe(2);
    });
  });

  describe("prune", () => {
    it("deletes events before cutoff", async () => {
      const now = new Date();
      const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      await storage.store(makeEvent({ timestamp: old.toISOString() }));
      await storage.store(makeEvent({ timestamp: now.toISOString() }));

      const pruned = await storage.prune(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
      expect(pruned).toBe(1);
      expect(await storage.count()).toBe(1);
    });
  });

  describe("count", () => {
    it("counts all events without filter", async () => {
      await storage.storeBatch([makeEvent(), makeEvent(), makeEvent()]);
      expect(await storage.count()).toBe(3);
    });

    it("counts filtered events", async () => {
      await storage.store(makeEvent({ attribution: { userId: "a", orgId: "org-1" } }));
      await storage.store(makeEvent({ attribution: { userId: "b", orgId: "org-1" } }));

      expect(await storage.count({ userId: "a" })).toBe(1);
    });
  });
});
