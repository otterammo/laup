import { z } from "zod";

/**
 * Handoff mode (HAND-004, HAND-005).
 */
export const HandoffModeSchema = z.enum([
  "sync", // Wait for acknowledgment (HAND-004)
  "async", // Queue for delivery (HAND-005)
]);

export type HandoffMode = z.infer<typeof HandoffModeSchema>;

/**
 * Handoff status.
 */
export const HandoffStatusSchema = z.enum([
  "pending", // Waiting to be sent
  "sent", // Sent, awaiting ack
  "acknowledged", // Received and acknowledged
  "rejected", // Rejected by receiver
  "timeout", // Timed out waiting for ack
  "failed", // Delivery failed
]);

export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

/**
 * Handoff routing policy (HAND-007).
 */
export const HandoffRoutingSchema = z.enum([
  "direct", // Direct to specific agent
  "round-robin", // Round-robin across agent pool
  "least-loaded", // Route to least-loaded agent
  "capability-match", // Route based on capability requirements
]);

export type HandoffRouting = z.infer<typeof HandoffRoutingSchema>;

/**
 * Context field for partial handoff (HAND-009).
 */
export const ContextFieldSchema = z.object({
  /** Field path (dot notation) */
  path: z.string(),

  /** Whether field is required */
  required: z.boolean().optional(),

  /** Whether to redact sensitive data */
  redact: z.boolean().optional(),
});

export type ContextField = z.infer<typeof ContextFieldSchema>;

/**
 * Standard context packet format for handoff (HAND-001).
 * Tool-agnostic by design: tool fields are open strings and context fields are generic records.
 */
export const ContextPacketSchema = z.object({
  /** Unique packet ID */
  packetId: z.string().min(1),

  /** Schema version (semver) */
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),

  /** Sending tool identifier */
  sendingTool: z.string().min(1),

  /** Receiving tool identifier */
  receivingTool: z.string().min(1),

  /** Current task payload */
  task: z.record(z.string(), z.unknown()),

  /** Working context payload */
  workingContext: z.record(z.string(), z.unknown()),

  /** Memory references */
  memoryRefs: z.array(z.string()),

  /** Conversation summary */
  conversationSummary: z.string(),

  /** Constraints to apply during handoff */
  constraints: z.array(z.string()),

  /** Permission policy payload */
  permissionPolicy: z.record(z.string(), z.unknown()),

  /** Creation timestamp */
  timestamp: z.string().datetime(),

  /** Field subset for partial handoff (HAND-009) */
  fieldSubset: z.array(ContextFieldSchema).optional(),

  /** Whether packet is compressed (HAND-010) */
  compressed: z.boolean().default(false),

  /** Compression algorithm if compressed */
  compressionAlgorithm: z.enum(["gzip", "lz4", "zstd"]).optional(),

  /** Original size before compression */
  originalSizeBytes: z.number().optional(),
});

export type ContextPacket = z.infer<typeof ContextPacketSchema>;

/**
 * Handoff acknowledgment.
 */
export const HandoffAckSchema = z.object({
  /** Packet ID being acknowledged */
  packetId: z.string(),

  /** Acknowledging agent ID */
  agentId: z.string(),

  /** Acknowledgment status */
  status: z.enum(["accepted", "rejected"]),

  /** Rejection reason if rejected */
  reason: z.string().optional(),

  /** Timestamp */
  timestamp: z.string(),
});

export type HandoffAck = z.infer<typeof HandoffAckSchema>;

/**
 * Handoff history entry (HAND-008).
 */
export const HandoffRoutingDecisionSchema = z.object({
  /** Routing mode used for decision */
  routing: HandoffRoutingSchema,

  /** Selected target tool */
  selectedTool: z.string(),

  /** Human-readable reason for selection */
  reason: z.string(),

  /** Candidate tools considered by router */
  consideredTools: z.array(z.string()),

  /** Optional candidate scores from policy routing */
  scoredCandidates: z
    .array(
      z.object({
        tool: z.string(),
        score: z.number(),
      }),
    )
    .optional(),
});

/**
 * Handoff history entry (HAND-008).
 */
export const HandoffHistoryEntrySchema = z.object({
  /** Unique entry ID */
  id: z.string(),

  /** Packet ID */
  packetId: z.string(),

  /** Source agent */
  sourceAgent: z.string(),

  /** Target agent */
  targetAgent: z.string(),

  /** Handoff mode used */
  mode: HandoffModeSchema,

  /** Final status */
  status: HandoffStatusSchema,

  /** Routing decision record (HAND-007) */
  routingDecision: HandoffRoutingDecisionSchema.optional(),

  /** Timestamps */
  timestamps: z.object({
    created: z.string(),
    sent: z.string().optional(),
    acknowledged: z.string().optional(),
    completed: z.string().optional(),
  }),

  /** Duration in milliseconds */
  durationMs: z.number().optional(),

  /** Packet size in bytes */
  packetSizeBytes: z.number().optional(),

  /** Error details if failed */
  error: z.string().optional(),
});

export type HandoffRoutingDecision = z.infer<typeof HandoffRoutingDecisionSchema>;

export type HandoffHistoryEntry = z.infer<typeof HandoffHistoryEntrySchema>;

/**
 * Handoff template for workflows (HAND-011).
 */
export const HandoffTemplateSchema = z.object({
  /** Template ID */
  id: z.string(),

  /** Template name */
  name: z.string(),

  /** Description */
  description: z.string().optional(),

  /** Default handoff configuration */
  defaults: z
    .object({
      mode: HandoffModeSchema.optional(),
      routing: HandoffRoutingSchema.optional(),
      timeoutSeconds: z.number().optional(),
      requiredCapabilities: z.array(z.string()).optional(),
      fieldSubset: z.array(ContextFieldSchema).optional(),
    })
    .optional(),

  /** Variable placeholders */
  variables: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().default(false),
        defaultValue: z.unknown().optional(),
      }),
    )
    .optional(),
});

export type HandoffTemplate = z.infer<typeof HandoffTemplateSchema>;

/**
 * Security validation result (HAND-006).
 */
export interface SecurityValidationResult {
  valid: boolean;
  issues: Array<{
    severity: "error" | "warning";
    field: string;
    message: string;
  }>;
}

/**
 * Validate a context packet for security (HAND-006).
 */
export function validatePacketSecurity(packet: ContextPacket): SecurityValidationResult {
  const issues: SecurityValidationResult["issues"] = [];

  // Check for sensitive patterns in working context keys
  const sensitivePatterns = [/password/i, /secret/i, /api_key/i, /token/i, /credential/i];

  for (const key of Object.keys(packet.workingContext)) {
    for (const pattern of sensitivePatterns) {
      if (pattern.test(key)) {
        issues.push({
          severity: "warning",
          field: `workingContext.${key}`,
          message: `Field "${key}" may contain sensitive data`,
        });
      }
    }
  }

  // Check conversation summary for PII patterns
  const piiPatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b\d{16}\b/, // Credit card
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, // Email
  ];

  for (const pattern of piiPatterns) {
    if (pattern.test(packet.conversationSummary)) {
      issues.push({
        severity: "warning",
        field: "conversationSummary",
        message: "Conversation summary may contain PII",
      });
      break;
    }
  }

  return {
    valid: issues.filter((i) => i.severity === "error").length === 0,
    issues,
  };
}

/**
 * Estimate compressed size for a packet (HAND-010).
 */
export function estimateCompressedSize(packet: ContextPacket): number {
  const json = JSON.stringify(packet);
  // Rough estimate: JSON typically compresses to 10-30% of original size
  return Math.ceil(json.length * 0.2);
}

/**
 * Check if packet should be compressed (HAND-010).
 */
export function shouldCompressPacket(packet: ContextPacket, thresholdBytes = 10240): boolean {
  const json = JSON.stringify(packet);
  return json.length > thresholdBytes;
}

/**
 * Create a partial packet with field subset (HAND-009).
 */
export function createPartialPacket(
  packet: ContextPacket,
  fields: ContextField[],
): Partial<ContextPacket> {
  const partial: Partial<ContextPacket> = {
    packetId: packet.packetId,
    schemaVersion: packet.schemaVersion,
    sendingTool: packet.sendingTool,
    receivingTool: packet.receivingTool,
    task: packet.task,
    workingContext: packet.workingContext,
    memoryRefs: packet.memoryRefs,
    conversationSummary: packet.conversationSummary,
    constraints: packet.constraints,
    permissionPolicy: packet.permissionPolicy,
    timestamp: packet.timestamp,
  };

  for (const field of fields) {
    const value = getNestedValue(packet, field.path);
    if (value !== undefined) {
      setNestedValue(partial, field.path, field.redact ? "[REDACTED]" : value);
    } else if (field.required) {
      throw new Error(`Required field "${field.path}" not found in packet`);
    }
  }

  return partial;
}

/**
 * Get nested value from object.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set nested value in object.
 */
function isSafePathSegment(segment: string): boolean {
  return segment !== "__proto__" && segment !== "prototype" && segment !== "constructor";
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined || !isSafePathSegment(part)) continue;

    const existing = current[part];
    if (existing === undefined) {
      current[part] = {};
    } else if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
      return;
    }

    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  if (lastPart && isSafePathSegment(lastPart)) {
    current[lastPart] = value;
  }
}
