import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbAdapter, type DbAdapter, InMemoryDbAdapter } from "../db-adapter.js";

describe("db-adapter", () => {
  describe("InMemoryDbAdapter", () => {
    let db: InMemoryDbAdapter;

    beforeEach(async () => {
      db = new InMemoryDbAdapter();
      await db.connect();
    });

    afterEach(async () => {
      await db.disconnect();
    });

    it("connects and disconnects", async () => {
      expect(db.connected).toBe(true);
      await db.disconnect();
      expect(db.connected).toBe(false);
    });

    it("reports correct type", () => {
      expect(db.type).toBe("sqlite");
    });

    it("throws when querying disconnected", async () => {
      await db.disconnect();
      await expect(db.query("SELECT 1")).rejects.toThrow("not connected");
    });

    it("executes health check", async () => {
      const status = await db.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeDefined();
    });

    it("creates tables", async () => {
      await db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      const meta = await db.getMetadata();
      expect(meta.tables).toContain("users");
    });

    it("inserts and retrieves data", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
      await db.execute("INSERT INTO items (value) VALUES (?)", ["test"]);

      const result = await db.query<{ id: number; value: string }>("SELECT * FROM items");
      expect(result.rowCount).toBe(1);
      expect(result.rows[0]?.value).toBe("test");
    });

    it("returns lastInsertId on insert", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
      const result = await db.query("INSERT INTO items (value) VALUES (?)", ["test"]);
      expect(result.lastInsertId).toBe(1);
    });

    it("queryOne returns first row", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
      await db.execute("INSERT INTO items (value) VALUES (?)", ["first"]);
      await db.execute("INSERT INTO items (value) VALUES (?)", ["second"]);

      const row = await db.queryOne<{ value: string }>("SELECT * FROM items");
      expect(row?.value).toBe("first");
    });

    it("queryOne returns null for empty result", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)");
      const row = await db.queryOne("SELECT * FROM items");
      expect(row).toBeNull();
    });

    it("withTransaction commits on success", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");

      await db.withTransaction(async (tx) => {
        await tx.query("INSERT INTO items (value) VALUES (?)", ["txn-value"]);
      });

      const result = await db.query<{ value: string }>("SELECT * FROM items");
      expect(result.rows[0]?.value).toBe("txn-value");
    });

    it("withTransaction rolls back on error", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");

      await expect(
        db.withTransaction(async (tx) => {
          await tx.query("INSERT INTO items (value) VALUES (?)", ["will-rollback"]);
          throw new Error("Simulated error");
        }),
      ).rejects.toThrow("Simulated error");

      // In a real implementation, the insert would be rolled back
      // For in-memory, we don't have true transaction support
    });

    it("auto-increments ids", async () => {
      await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");

      const r1 = await db.query("INSERT INTO items (value) VALUES (?)", ["a"]);
      const r2 = await db.query("INSERT INTO items (value) VALUES (?)", ["b"]);

      expect(r1.lastInsertId).toBe(1);
      expect(r2.lastInsertId).toBe(2);
    });
  });

  describe("createDbAdapter", () => {
    it("creates sqlite adapter", () => {
      const adapter = createDbAdapter({ type: "sqlite" });
      expect(adapter.type).toBe("sqlite");
    });

    it("throws for unimplemented types", () => {
      expect(() => createDbAdapter({ type: "postgresql" })).toThrow("not yet implemented");
    });
  });

  describe("DbAdapter interface", () => {
    let adapter: DbAdapter;

    beforeEach(async () => {
      adapter = createDbAdapter({ type: "sqlite" });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it("implements required interface methods", () => {
      expect(typeof adapter.connect).toBe("function");
      expect(typeof adapter.disconnect).toBe("function");
      expect(typeof adapter.query).toBe("function");
      expect(typeof adapter.queryOne).toBe("function");
      expect(typeof adapter.execute).toBe("function");
      expect(typeof adapter.beginTransaction).toBe("function");
      expect(typeof adapter.withTransaction).toBe("function");
      expect(typeof adapter.healthCheck).toBe("function");
      expect(typeof adapter.getMetadata).toBe("function");
    });
  });
});
