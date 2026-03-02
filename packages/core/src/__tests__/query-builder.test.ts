import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDbAdapter } from "../db-adapter.js";
import { createQueryBuilder, query } from "../query-builder.js";

describe("query-builder", () => {
  let db: InMemoryDbAdapter;

  beforeEach(async () => {
    db = new InMemoryDbAdapter();
    await db.connect();
  });

  describe("build", () => {
    it("builds simple SELECT", () => {
      const qb = createQueryBuilder(db).from("users");
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users");
    });

    it("builds SELECT with specific fields", () => {
      const qb = createQueryBuilder(db).select("id", "name").from("users");
      const { sql } = qb.build();
      expect(sql).toBe("SELECT id, name FROM users");
    });

    it("builds WHERE clause", () => {
      const qb = createQueryBuilder(db).from("users").where("status", "=", "active");
      const { sql, params } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE status = ?");
      expect(params).toEqual(["active"]);
    });

    it("builds multiple AND conditions", () => {
      const qb = createQueryBuilder(db)
        .from("users")
        .where("status", "=", "active")
        .and("age", ">", 18);
      const { sql, params } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE status = ? AND age > ?");
      expect(params).toEqual(["active", 18]);
    });

    it("builds OR conditions", () => {
      const qb = createQueryBuilder(db)
        .from("users")
        .where("role", "=", "admin")
        .or("role", "=", "superuser");
      const { sql, params } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE role = ? OR role = ?");
      expect(params).toEqual(["admin", "superuser"]);
    });

    it("builds LIKE condition", () => {
      const qb = createQueryBuilder(db).from("users").where("name", "like", "%john%");
      const { sql, params } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE name LIKE ?");
      expect(params).toEqual(["%john%"]);
    });

    it("builds IN condition", () => {
      const qb = createQueryBuilder(db).from("users").where("id", "in", [1, 2, 3]);
      const { sql, params } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE id IN (?, ?, ?)");
      expect(params).toEqual([1, 2, 3]);
    });

    it("builds IS NULL condition", () => {
      const qb = createQueryBuilder(db).from("users").where("deleted_at", "is_null", null);
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE deleted_at IS NULL");
    });

    it("builds IS NOT NULL condition", () => {
      const qb = createQueryBuilder(db).from("users").where("email", "is_not_null", null);
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users WHERE email IS NOT NULL");
    });

    it("builds ORDER BY", () => {
      const qb = createQueryBuilder(db).from("users").orderBy("created_at", "desc");
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users ORDER BY created_at DESC");
    });

    it("builds multiple ORDER BY", () => {
      const qb = createQueryBuilder(db)
        .from("users")
        .orderBy("status", "asc")
        .orderBy("name", "desc");
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users ORDER BY status ASC, name DESC");
    });

    it("builds LIMIT", () => {
      const qb = createQueryBuilder(db).from("users").limit(10);
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users LIMIT 10");
    });

    it("builds OFFSET", () => {
      const qb = createQueryBuilder(db).from("users").limit(10).offset(20);
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });

    it("builds GROUP BY", () => {
      const qb = createQueryBuilder(db).from("orders").groupBy("user_id");
      const { sql } = qb.build();
      expect(sql).toContain("GROUP BY user_id");
    });

    it("builds aggregate COUNT", () => {
      const qb = createQueryBuilder(db).from("users").aggregate("count", "*", "total");
      const { sql } = qb.build();
      expect(sql).toContain("COUNT(*) AS total");
    });

    it("builds aggregate SUM", () => {
      const qb = createQueryBuilder(db)
        .from("orders")
        .groupBy("user_id")
        .aggregate("sum", "amount", "total_amount");
      const { sql } = qb.build();
      expect(sql).toContain("SUM(amount) AS total_amount");
    });

    it("builds aggregate AVG", () => {
      const qb = createQueryBuilder(db).from("products").aggregate("avg", "price", "avg_price");
      const { sql } = qb.build();
      expect(sql).toContain("AVG(price) AS avg_price");
    });

    it("builds time bucket for day", () => {
      const qb = createQueryBuilder(db).from("events").timeBucket("timestamp", "day", "date");
      const { sql } = qb.build();
      expect(sql).toContain("date(timestamp) AS date");
    });

    it("builds time bucket for month", () => {
      const qb = createQueryBuilder(db).from("events").timeBucket("timestamp", "month", "month");
      const { sql } = qb.build();
      expect(sql).toContain("strftime('%Y-%m', timestamp) AS month");
    });

    it("builds cursor pagination", () => {
      const qb = createQueryBuilder(db).from("users").cursor("cursor-123", "id").limit(10);
      const { sql, params } = qb.build();
      expect(sql).toContain("id > ?");
      expect(params).toContain("cursor-123");
    });

    it("generates count query with limit", () => {
      const qb = createQueryBuilder(db).from("users").where("active", "=", true).limit(10);
      const { countSql } = qb.build();
      expect(countSql).toBe("SELECT COUNT(*) AS total FROM users WHERE active = ?");
    });
  });

  describe("query shorthand", () => {
    it("creates builder with table set", () => {
      const qb = query(db, "users");
      const { sql } = qb.build();
      expect(sql).toBe("SELECT * FROM users");
    });

    it("chains methods", () => {
      const qb = query(db, "orders")
        .where("status", "=", "pending")
        .orderBy("created_at", "desc")
        .limit(20);

      const { sql, params } = qb.build();
      expect(sql).toBe("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 20");
      expect(params).toEqual(["pending"]);
    });
  });

  describe("complex queries", () => {
    it("builds dashboard query", () => {
      const qb = createQueryBuilder(db)
        .from("usage_events")
        .where("timestamp", ">=", "2024-01-01")
        .and("type", "=", "llm-call")
        .groupBy("user_id")
        .aggregate("count", "*", "total_calls")
        .aggregate("sum", "tokens", "total_tokens")
        .orderBy("total_tokens", "desc")
        .limit(10);

      const { sql, params } = qb.build();
      expect(sql).toContain("FROM usage_events");
      expect(sql).toContain("WHERE timestamp >= ?");
      expect(sql).toContain("AND type = ?");
      expect(sql).toContain("GROUP BY user_id");
      expect(sql).toContain("COUNT(*) AS total_calls");
      expect(sql).toContain("SUM(tokens) AS total_tokens");
      expect(sql).toContain("ORDER BY total_tokens DESC");
      expect(sql).toContain("LIMIT 10");
      expect(params).toEqual(["2024-01-01", "llm-call"]);
    });

    it("builds time-series query", () => {
      const qb = createQueryBuilder(db)
        .from("events")
        .timeBucket("timestamp", "day", "date")
        .aggregate("count", "*", "count")
        .orderBy("date", "asc");

      const { sql } = qb.build();
      expect(sql).toContain("date(timestamp) AS date");
      expect(sql).toContain("COUNT(*) AS count");
      expect(sql).toContain("GROUP BY date");
      expect(sql).toContain("ORDER BY date ASC");
    });
  });
});
