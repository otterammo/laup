import { describe, expect, it } from "vitest";
import {
  type ContextField,
  type ContextPacket,
  ContextPacketSchema,
  createPartialPacket,
  estimateCompressedSize,
  shouldCompressPacket,
  validatePacketSecurity,
} from "../handoff-schema.js";

describe("handoff-schema", () => {
  const samplePacket: ContextPacket = {
    packetId: "packet-1",
    schemaVersion: "1.0.0",
    sendingTool: "codex",
    receivingTool: "claude-code",
    task: {
      type: "code-review",
      title: "Review auth middleware",
    },
    workingContext: {
      currentFile: "src/main.ts",
      lineNumber: 42,
    },
    memoryRefs: ["mem://handoff/123"],
    conversationSummary: "User asked for help with a code review.",
    constraints: ["Do not modify public API"],
    permissionPolicy: {
      allow: ["read", "write"],
      deny: ["network"],
    },
    timestamp: "2026-01-15T10:00:00Z",
    compressed: false,
  };

  describe("ContextPacketSchema", () => {
    it("validates valid packet", () => {
      const result = ContextPacketSchema.safeParse(samplePacket);
      expect(result.success).toBe(true);
    });

    it("requires all HAND-001 fields", () => {
      const minimal = {
        packetId: "p-1",
        schemaVersion: "1.0.0",
        sendingTool: "codex",
        receivingTool: "claude-code",
        task: {},
        workingContext: {},
        memoryRefs: [],
        conversationSummary: "summary",
        constraints: [],
        permissionPolicy: {},
        timestamp: "2026-01-15T10:00:00Z",
      };
      const result = ContextPacketSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it("rejects packet without packetId", () => {
      const invalid = { ...samplePacket, packetId: undefined };
      const result = ContextPacketSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("requires semver schemaVersion", () => {
      const invalidVersion = { ...samplePacket, schemaVersion: "1.0" };
      const result = ContextPacketSchema.safeParse(invalidVersion);
      expect(result.success).toBe(false);
    });

    it("validates with field subset", () => {
      const withSubset: ContextPacket = {
        ...samplePacket,
        fieldSubset: [
          { path: "task.title", required: true },
          { path: "workingContext.currentFile", redact: false },
        ],
      };
      const result = ContextPacketSchema.safeParse(withSubset);
      expect(result.success).toBe(true);
    });

    it("validates compressed packet", () => {
      const compressed: ContextPacket = {
        ...samplePacket,
        compressed: true,
        compressionAlgorithm: "gzip",
        originalSizeBytes: 5000,
      };
      const result = ContextPacketSchema.safeParse(compressed);
      expect(result.success).toBe(true);
    });
  });

  describe("validatePacketSecurity (HAND-006)", () => {
    it("passes for clean packet", () => {
      const result = validatePacketSecurity(samplePacket);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("warns about sensitive field names", () => {
      const sensitivePacket: ContextPacket = {
        ...samplePacket,
        workingContext: {
          password: "secret123",
          api_key: "sk-xxx",
        },
      };
      const result = validatePacketSecurity(sensitivePacket);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.field.includes("password"))).toBe(true);
    });

    it("warns about PII in conversation summary", () => {
      const piiPacket: ContextPacket = {
        ...samplePacket,
        conversationSummary: "My email is test@example.com",
      };
      const result = validatePacketSecurity(piiPacket);
      expect(result.issues.some((i) => i.message.includes("PII"))).toBe(true);
    });
  });

  describe("shouldCompressPacket (HAND-010)", () => {
    it("returns false for small packets", () => {
      expect(shouldCompressPacket(samplePacket)).toBe(false);
    });

    it("returns true for large packets", () => {
      const largePacket: ContextPacket = {
        ...samplePacket,
        conversationSummary: "A".repeat(100_000),
      };
      expect(shouldCompressPacket(largePacket)).toBe(true);
    });

    it("respects custom threshold", () => {
      expect(shouldCompressPacket(samplePacket, 100)).toBe(true);
    });
  });

  describe("estimateCompressedSize (HAND-010)", () => {
    it("returns smaller than original", () => {
      const original = JSON.stringify(samplePacket).length;
      const estimated = estimateCompressedSize(samplePacket);
      expect(estimated).toBeLessThan(original);
    });
  });

  describe("createPartialPacket (HAND-009)", () => {
    it("extracts specified fields", () => {
      const fields: ContextField[] = [
        { path: "task.title", required: false },
        { path: "workingContext.currentFile", required: false },
      ];
      const partial = createPartialPacket(samplePacket, fields);
      expect(partial.packetId).toBe(samplePacket.packetId);
      expect(partial).toHaveProperty("task");
    });

    it("throws for missing required field", () => {
      const fields: ContextField[] = [{ path: "nonexistent.field", required: true }];
      expect(() => createPartialPacket(samplePacket, fields)).toThrow();
    });

    it("redacts sensitive fields", () => {
      const fields: ContextField[] = [
        { path: "workingContext.currentFile", redact: true, required: false },
      ];
      const partial = createPartialPacket(samplePacket, fields);
      expect(
        (partial as { workingContext?: { currentFile?: string } }).workingContext?.currentFile,
      ).toBe("[REDACTED]");
    });
  });
});
