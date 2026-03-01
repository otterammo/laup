import { beforeEach, describe, expect, it } from "vitest";
import {
  type AuditEntry,
  type AuditStorage,
  auditConfigChange,
  auditSecurityEvent,
  InMemoryAuditStorage,
} from "../audit-storage.js";

describe("audit-storage", () => {
  let storage: AuditStorage;

  const makeEntry = (
    overrides: Partial<Omit<AuditEntry, "id" | "timestamp">> = {},
  ): Omit<AuditEntry, "id" | "timestamp"> => ({
    category: "config",
    action: "update",
    actor: "user-1",
    severity: "info",
    ...overrides,
  });

  beforeEach(async () => {
    storage = new InMemoryAuditStorage();
    await storage.init();
  });

  describe("append", () => {
    it("appends an entry and returns an id", async () => {
      const id = await storage.append(makeEntry());
      expect(id).toMatch(/^aud_/);
    });

    it("assigns timestamp automatically", async () => {
      const id = await storage.append(makeEntry());
      const entry = await storage.get(id);
      expect(entry?.timestamp).toBeDefined();
    });
  });

  describe("appendBatch", () => {
    it("appends multiple entries", async () => {
      const ids = await storage.appendBatch([makeEntry(), makeEntry(), makeEntry()]);
      expect(ids).toHaveLength(3);
    });

    it("returns unique ids", async () => {
      const ids = await storage.appendBatch([makeEntry(), makeEntry()]);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

  describe("get", () => {
    it("retrieves an entry by id", async () => {
      const id = await storage.append(makeEntry({ action: "test-action" }));
      const entry = await storage.get(id);
      expect(entry?.action).toBe("test-action");
    });

    it("returns null for unknown id", async () => {
      const entry = await storage.get("unknown");
      expect(entry).toBeNull();
    });
  });

  describe("query", () => {
    it("returns all entries without filter", async () => {
      await storage.appendBatch([makeEntry(), makeEntry()]);
      const result = await storage.query({});
      expect(result.entries).toHaveLength(2);
    });

    it("filters by category", async () => {
      await storage.append(makeEntry({ category: "config" }));
      await storage.append(makeEntry({ category: "security" }));

      const result = await storage.query({ category: "config" });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]?.category).toBe("config");
    });

    it("filters by actor", async () => {
      await storage.append(makeEntry({ actor: "alice" }));
      await storage.append(makeEntry({ actor: "bob" }));

      const result = await storage.query({ actor: "alice" });
      expect(result.entries).toHaveLength(1);
    });

    it("filters by severity", async () => {
      await storage.append(makeEntry({ severity: "info" }));
      await storage.append(makeEntry({ severity: "critical" }));

      const result = await storage.query({ severity: "critical" });
      expect(result.entries).toHaveLength(1);
    });

    it("filters by time range", async () => {
      const now = new Date();
      await storage.append(makeEntry());

      // Query for future entries should return nothing
      const result = await storage.query({
        startTime: new Date(now.getTime() + 1000),
      });
      expect(result.entries).toHaveLength(0);
    });

    it("supports pagination", async () => {
      await storage.appendBatch([makeEntry(), makeEntry(), makeEntry(), makeEntry(), makeEntry()]);

      const page1 = await storage.query({}, 2, 0);
      expect(page1.entries).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await storage.query({}, 2, 4);
      expect(page2.entries).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it("sorts by timestamp descending", async () => {
      await storage.append(makeEntry({ action: "first" }));
      await new Promise((r) => setTimeout(r, 10));
      await storage.append(makeEntry({ action: "second" }));

      const result = await storage.query({});
      expect(result.entries[0]?.action).toBe("second");
      expect(result.entries[1]?.action).toBe("first");
    });
  });

  describe("getByCorrelation", () => {
    it("returns entries with matching correlation id", async () => {
      await storage.append(makeEntry({ correlationId: "req-123", action: "step1" }));
      await storage.append(makeEntry({ correlationId: "req-123", action: "step2" }));
      await storage.append(makeEntry({ correlationId: "req-456", action: "other" }));

      const entries = await storage.getByCorrelation("req-123");
      expect(entries).toHaveLength(2);
    });

    it("returns entries in chronological order", async () => {
      await storage.append(makeEntry({ correlationId: "req-1", action: "first" }));
      await new Promise((r) => setTimeout(r, 10));
      await storage.append(makeEntry({ correlationId: "req-1", action: "second" }));

      const entries = await storage.getByCorrelation("req-1");
      expect(entries[0]?.action).toBe("first");
      expect(entries[1]?.action).toBe("second");
    });
  });

  describe("stats", () => {
    it("returns total count", async () => {
      await storage.appendBatch([makeEntry(), makeEntry(), makeEntry()]);
      const stats = await storage.stats();
      expect(stats.totalEntries).toBe(3);
    });

    it("counts by category", async () => {
      await storage.append(makeEntry({ category: "config" }));
      await storage.append(makeEntry({ category: "config" }));
      await storage.append(makeEntry({ category: "security" }));

      const stats = await storage.stats();
      expect(stats.byCategory["config"]).toBe(2);
      expect(stats.byCategory["security"]).toBe(1);
    });

    it("counts by severity", async () => {
      await storage.append(makeEntry({ severity: "info" }));
      await storage.append(makeEntry({ severity: "critical" }));
      await storage.append(makeEntry({ severity: "critical" }));

      const stats = await storage.stats();
      expect(stats.bySeverity["info"]).toBe(1);
      expect(stats.bySeverity["critical"]).toBe(2);
    });

    it("tracks oldest and newest entries", async () => {
      await storage.append(makeEntry());
      await new Promise((r) => setTimeout(r, 10));
      await storage.append(makeEntry());

      const stats = await storage.stats();
      expect(stats.oldestEntry).toBeDefined();
      expect(stats.newestEntry).toBeDefined();
      expect(stats.oldestEntry! < stats.newestEntry!).toBe(true);
    });
  });

  describe("export", () => {
    it("exports as JSON", async () => {
      await storage.append(makeEntry({ action: "test" }));

      const json = await storage.export({ format: "json" });
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].action).toBe("test");
    });

    it("exports as CSV", async () => {
      await storage.append(makeEntry({ action: "test", actor: "alice" }));

      const csv = await storage.export({ format: "csv" });
      expect(csv).toContain("id,timestamp,category,action,actor");
      expect(csv).toContain("test");
      expect(csv).toContain("alice");
    });

    it("filters by category", async () => {
      await storage.append(makeEntry({ category: "config" }));
      await storage.append(makeEntry({ category: "security" }));

      const json = await storage.export({ format: "json", categories: ["config"] });
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
    });

    it("excludes state diffs by default", async () => {
      await storage.append(
        makeEntry({
          previousState: { foo: 1 },
          newState: { foo: 2 },
        }),
      );

      const json = await storage.export({ format: "json", includeStateDiffs: false });
      const parsed = JSON.parse(json);
      expect(parsed[0].previousState).toBeUndefined();
      expect(parsed[0].newState).toBeUndefined();
    });
  });

  describe("verifyIntegrity", () => {
    it("returns valid for in-memory storage", async () => {
      await storage.append(makeEntry());
      const result = await storage.verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("archive", () => {
    it("archives entries before cutoff", async () => {
      await storage.append(makeEntry());
      await new Promise((r) => setTimeout(r, 50));

      const cutoff = new Date();
      await storage.append(makeEntry());

      const archived = await storage.archive(cutoff);
      expect(archived).toBe(1);

      const stats = await storage.stats();
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe("helper functions", () => {
    describe("auditConfigChange", () => {
      it("creates a config change entry", () => {
        const entry = auditConfigChange(
          "admin",
          "update",
          "setting-1",
          { value: 1 },
          { value: 2 },
          "Updated setting",
        );

        expect(entry.category).toBe("config");
        expect(entry.action).toBe("update");
        expect(entry.actor).toBe("admin");
        expect(entry.targetId).toBe("setting-1");
        expect(entry.previousState).toEqual({ value: 1 });
        expect(entry.newState).toEqual({ value: 2 });
        expect(entry.reason).toBe("Updated setting");
      });
    });

    describe("auditSecurityEvent", () => {
      it("creates a security event entry", () => {
        const entry = auditSecurityEvent("system", "intrusion-detected", "critical", {
          ip: "1.2.3.4",
        });

        expect(entry.category).toBe("security");
        expect(entry.action).toBe("intrusion-detected");
        expect(entry.severity).toBe("critical");
        expect(entry.metadata).toEqual({ ip: "1.2.3.4" });
      });
    });
  });
});
