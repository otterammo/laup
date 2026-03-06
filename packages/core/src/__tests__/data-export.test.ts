import { describe, expect, it } from "vitest";
import {
  aggregateUsageRecords,
  createStreamingExporter,
  exportData,
  exportToCsv,
  exportToJson,
  exportToJsonl,
  filterByDateRange,
} from "../data-export.js";

describe("data-export", () => {
  const sampleRecords = [
    { id: "1", name: "Alice", email: "alice@example.com", age: 30 },
    { id: "2", name: "Bob", email: "bob@example.com", age: 25 },
    { id: "3", name: "Charlie", email: "charlie@example.com", age: 35 },
  ];

  const nestedRecords = [
    { id: "1", user: { name: "Alice", contact: { email: "alice@example.com" } } },
    { id: "2", user: { name: "Bob", contact: { email: "bob@example.com" } } },
  ];

  describe("exportToJson", () => {
    it("exports records as JSON array", () => {
      const result = exportToJson(sampleRecords);
      expect(result.format).toBe("json");
      expect(result.recordCount).toBe(3);

      const parsed = JSON.parse(result.data);
      expect(parsed).toHaveLength(3);
      expect(parsed[0].name).toBe("Alice");
    });

    it("pretty prints when requested", () => {
      const result = exportToJson(sampleRecords, { pretty: true });
      expect(result.data).toContain("\n");
      expect(result.data).toContain("  ");
    });

    it("filters fields", () => {
      const result = exportToJson(sampleRecords, { fields: ["id", "name"] });
      const parsed = JSON.parse(result.data);
      expect(Object.keys(parsed[0])).toEqual(["id", "name"]);
    });

    it("excludes fields", () => {
      const result = exportToJson(sampleRecords, { excludeFields: ["email"] });
      const parsed = JSON.parse(result.data);
      expect(parsed[0].email).toBeUndefined();
    });

    it("flattens nested objects", () => {
      const result = exportToJson(nestedRecords);
      expect(result.fields).toContain("user.name");
      expect(result.fields).toContain("user.contact.email");
    });
  });

  describe("exportToJsonl", () => {
    it("exports records as JSON Lines", () => {
      const result = exportToJsonl(sampleRecords);
      expect(result.format).toBe("jsonl");

      const lines = result.data.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBeDefined();

      const first = JSON.parse(lines[0] as string);
      expect(first.name).toBe("Alice");
    });

    it("filters fields", () => {
      const result = exportToJsonl(sampleRecords, { fields: ["id"] });
      const lines = result.data.split("\n");
      expect(lines[0]).toBeDefined();
      const first = JSON.parse(lines[0] as string);
      expect(Object.keys(first)).toEqual(["id"]);
    });
  });

  describe("exportToCsv", () => {
    it("exports records as CSV", () => {
      const result = exportToCsv(sampleRecords);
      expect(result.format).toBe("csv");

      const lines = result.data.split("\n");
      expect(lines).toHaveLength(4); // header + 3 records
    });

    it("includes headers by default", () => {
      const result = exportToCsv(sampleRecords);
      const lines = result.data.split("\n");
      expect(lines[0]).toBeDefined();
      const header = lines[0] as string;
      expect(header).toContain("id");
      expect(header).toContain("name");
    });

    it("excludes headers when requested", () => {
      const result = exportToCsv(sampleRecords, { includeHeaders: false });
      const lines = result.data.split("\n");
      expect(lines).toHaveLength(3);
    });

    it("uses custom delimiter", () => {
      const result = exportToCsv(sampleRecords, { delimiter: ";" });
      expect(result.data).toContain(";");
    });

    it("escapes values with commas", () => {
      const records = [{ id: "1", desc: "Hello, World" }];
      const result = exportToCsv(records);
      expect(result.data).toContain('"Hello, World"');
    });

    it("escapes values with quotes", () => {
      const records = [{ id: "1", desc: 'Say "Hello"' }];
      const result = exportToCsv(records);
      expect(result.data).toContain('"Say ""Hello"""');
    });

    it("escapes values with newlines", () => {
      const records = [{ id: "1", desc: "Line1\nLine2" }];
      const result = exportToCsv(records);
      expect(result.data).toContain('"Line1\nLine2"');
    });
  });

  describe("exportData", () => {
    it("routes to correct exporter", () => {
      const json = exportData(sampleRecords, { format: "json" });
      expect(json.format).toBe("json");

      const csv = exportData(sampleRecords, { format: "csv" });
      expect(csv.format).toBe("csv");

      const jsonl = exportData(sampleRecords, { format: "jsonl" });
      expect(jsonl.format).toBe("jsonl");
    });

    it("throws for unsupported format", () => {
      // @ts-expect-error - Testing invalid format
      expect(() => exportData(sampleRecords, { format: "xml" })).toThrow("Unsupported format");
    });
  });

  describe("createStreamingExporter", () => {
    it("accumulates batches", async () => {
      const exporter = createStreamingExporter({ format: "json" });

      await exporter.write([{ id: "1" }, { id: "2" }]);
      await exporter.write([{ id: "3" }]);

      const result = await exporter.finalize();
      expect(result.recordCount).toBe(3);
    });

    it("collects all fields from batches", async () => {
      const exporter = createStreamingExporter({ format: "json" });

      await exporter.write([{ a: 1 }]);
      await exporter.write([{ b: 2 }]);

      const result = await exporter.finalize();
      expect(result.fields).toContain("a");
      expect(result.fields).toContain("b");
    });
  });

  describe("filterByDateRange", () => {
    const records = [
      { id: "1", timestamp: "2024-01-01T00:00:00Z" },
      { id: "2", timestamp: "2024-06-15T00:00:00Z" },
      { id: "3", timestamp: "2024-12-31T00:00:00Z" },
    ];

    it("filters by start date", () => {
      const filtered = filterByDateRange(records, {
        startDate: new Date("2024-06-01"),
      });
      expect(filtered).toHaveLength(2);
    });

    it("filters by end date", () => {
      const filtered = filterByDateRange(records, {
        endDate: new Date("2024-07-01"),
      });
      expect(filtered).toHaveLength(2);
    });

    it("filters by date range", () => {
      const filtered = filterByDateRange(records, {
        startDate: new Date("2024-03-01"),
        endDate: new Date("2024-09-01"),
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.id).toBe("2");
    });

    it("uses createdAt fallback", () => {
      const records = [{ id: "1", createdAt: "2024-06-15T00:00:00Z" }];
      const filtered = filterByDateRange(records, {
        startDate: new Date("2024-01-01"),
      });
      expect(filtered).toHaveLength(1);
    });
  });

  describe("aggregateUsageRecords", () => {
    const usageRecords = [
      {
        timestamp: "2024-01-15T10:00:00Z",
        attribution: { userId: "u1", projectId: "p1" },
        data: { model: "gpt-4", inputTokens: 100, outputTokens: 50 },
      },
      {
        timestamp: "2024-01-15T11:00:00Z",
        attribution: { userId: "u1", projectId: "p1" },
        data: { model: "gpt-4", inputTokens: 200, outputTokens: 100 },
      },
      {
        timestamp: "2024-01-16T10:00:00Z",
        attribution: { userId: "u2", projectId: "p2" },
        data: { model: "gpt-3.5", inputTokens: 50, outputTokens: 25 },
      },
    ];

    it("aggregates by user", () => {
      const result = aggregateUsageRecords(usageRecords, "user");
      expect(result).toHaveLength(2);

      const u1 = result.find((r) => r["user"] === "u1");
      expect(u1?.["totalRecords"]).toBe(2);
      expect(u1?.["totalInputTokens"]).toBe(300);
    });

    it("aggregates by day", () => {
      const result = aggregateUsageRecords(usageRecords, "day");
      expect(result).toHaveLength(2);

      const jan15 = result.find((r) => r["day"] === "2024-01-15");
      expect(jan15?.["totalRecords"]).toBe(2);
    });

    it("aggregates by model", () => {
      const result = aggregateUsageRecords(usageRecords, "model");
      expect(result).toHaveLength(2);

      const gpt4 = result.find((r) => r["model"] === "gpt-4");
      expect(gpt4?.["totalRecords"]).toBe(2);
    });

    it("returns original records without groupBy", () => {
      const result = aggregateUsageRecords(usageRecords, undefined);
      expect(result).toBe(usageRecords);
    });
  });
});
