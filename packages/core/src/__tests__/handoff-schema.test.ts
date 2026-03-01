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
    id: "packet-1",
    schemaVersion: "1.0",
    sourceAgent: "agent-a",
    targetAgent: "agent-b",
    mode: "sync",
    routing: "direct",
    timeoutSeconds: 60,
    conversation: {
      messages: [
        { role: "user", content: "Help me with this task" },
        { role: "assistant", content: "Sure, I can help" },
      ],
      task: "Code review",
    },
    state: {
      currentFile: "src/main.ts",
      lineNumber: 42,
    },
    compressed: false,
    metadata: {
      createdAt: "2026-01-15T10:00:00Z",
      priority: "normal",
    },
  };

  describe("ContextPacketSchema", () => {
    it("validates valid packet", () => {
      const result = ContextPacketSchema.safeParse(samplePacket);
      expect(result.success).toBe(true);
    });

    it("validates minimal packet", () => {
      const minimal = {
        id: "p-1",
        sourceAgent: "agent-a",
      };
      const result = ContextPacketSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it("rejects packet without id", () => {
      const invalid = { ...samplePacket, id: undefined };
      const result = ContextPacketSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("validates async mode", () => {
      const asyncPacket = { ...samplePacket, mode: "async" };
      const result = ContextPacketSchema.safeParse(asyncPacket);
      expect(result.success).toBe(true);
    });

    it("validates with field subset", () => {
      const withSubset: ContextPacket = {
        ...samplePacket,
        fieldSubset: [
          { path: "conversation.task", required: true },
          { path: "state.currentFile", redact: false },
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
        state: {
          password: "secret123",
          api_key: "sk-xxx",
        },
      };
      const result = validatePacketSecurity(sensitivePacket);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.field.includes("password"))).toBe(true);
    });

    it("warns about PII in messages", () => {
      const piiPacket: ContextPacket = {
        ...samplePacket,
        conversation: {
          messages: [{ role: "user", content: "My email is test@example.com" }],
        },
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
        conversation: {
          messages: Array(100).fill({
            role: "user",
            content: "A".repeat(1000),
          }),
        },
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
        { path: "conversation.task", required: false },
        { path: "state.currentFile", required: false },
      ];
      const partial = createPartialPacket(samplePacket, fields);
      expect(partial.id).toBe(samplePacket.id);
      expect((partial as Record<string, unknown>)["conversation"]).toBeDefined();
    });

    it("throws for missing required field", () => {
      const fields: ContextField[] = [{ path: "nonexistent.field", required: true }];
      expect(() => createPartialPacket(samplePacket, fields)).toThrow();
    });

    it("redacts sensitive fields", () => {
      const fields: ContextField[] = [{ path: "state.currentFile", redact: true, required: false }];
      const partial = createPartialPacket(samplePacket, fields);
      expect((partial as { state?: { currentFile?: string } }).state?.currentFile).toBe(
        "[REDACTED]",
      );
    });
  });
});
