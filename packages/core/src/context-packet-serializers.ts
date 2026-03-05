import { gunzipSync, gzipSync } from "node:zlib";
import {
  type ContextPacket,
  ContextPacketSchema,
  type HandoffMode,
  type HandoffRouting,
  type IncomingPacketPolicy,
  validateIncomingContextPacket,
} from "./handoff-schema.js";

type PacketPriority = "low" | "normal" | "high" | "urgent";

interface BaseSerializerInput {
  id: string;
  sourceAgent: string;
  targetAgent?: string;
  mode?: HandoffMode;
  routing?: HandoffRouting;
  timeoutSeconds?: number;
  createdAt: string;
  task?: string;
  requiredCapabilities?: string[];
  priority?: PacketPriority;
  tags?: string[];
}

export interface ClaudeCodeTaskContext {
  taskId: string;
  objective: string;
  status: "queued" | "running" | "completed" | "failed";
  notes?: string;
}

export interface ClaudeCodeSerializerInput extends BaseSerializerInput {
  native: {
    taskContext: ClaudeCodeTaskContext;
    activeFiles: string[];
    memoryMd: string;
  };
}

export interface CursorNotepad {
  id: string;
  title: string;
  content: string;
  updatedAt?: string;
}

export interface CursorEditorSelection {
  file: string;
  startLine: number;
  endLine: number;
}

export interface CursorSerializerInput extends BaseSerializerInput {
  native: {
    notepads: CursorNotepad[];
    editor: {
      workspaceRoot?: string;
      openFiles: string[];
      activeFile?: string;
      selections?: CursorEditorSelection[];
    };
  };
}

export interface ClaudeCodeDeserializerOutput {
  native: ClaudeCodeSerializerInput["native"];
  memoryWrite: {
    filePath: "MEMORY.md";
    mode: "prepend";
    content: string;
  };
}

export interface CursorDeserializerOutput {
  native: CursorSerializerInput["native"];
  actions: {
    createNotepads: CursorNotepad[];
    openFiles: string[];
    activeFile?: string;
  };
}

export interface DeserializeContextSecurityOptions {
  policy: IncomingPacketPolicy;
  logRejection?: (entry: { packetId?: string; sendingTool?: string; reasons: string[] }) => void;
}

export const DEFAULT_PACKET_COMPRESSION_THRESHOLD_BYTES = 256 * 1024;

/**
 * Compression algorithm used for HAND-010 transport packets.
 * We use gzip for broad runtime compatibility.
 */
export type ContextPacketCompressionAlgorithm = "gzip";

export interface CompressedContextPacketEnvelope {
  compressed: true;
  compressionAlgorithm: ContextPacketCompressionAlgorithm;
  originalSizeBytes: number;
  payloadBase64: string;
}

export type ContextPacketTransport = ContextPacket | CompressedContextPacketEnvelope;

function isCompressedEnvelope(candidate: unknown): candidate is CompressedContextPacketEnvelope {
  if (!candidate || typeof candidate !== "object") return false;
  const record = candidate as Record<string, unknown>;
  return (
    record["compressed"] === true &&
    record["compressionAlgorithm"] === "gzip" &&
    typeof record["originalSizeBytes"] === "number" &&
    typeof record["payloadBase64"] === "string"
  );
}

export function compressContextPacketForTransport(
  packet: ContextPacket,
  thresholdBytes = DEFAULT_PACKET_COMPRESSION_THRESHOLD_BYTES,
): ContextPacketTransport {
  const json = JSON.stringify(packet);
  const originalSizeBytes = Buffer.byteLength(json, "utf8");

  if (originalSizeBytes <= thresholdBytes) {
    return packet;
  }

  return {
    compressed: true,
    compressionAlgorithm: "gzip",
    originalSizeBytes,
    payloadBase64: gzipSync(json).toString("base64"),
  };
}

export function decompressContextPacketForValidation(candidate: unknown): unknown {
  if (!isCompressedEnvelope(candidate)) {
    return candidate;
  }

  const inflated = gunzipSync(Buffer.from(candidate.payloadBase64, "base64")).toString("utf8");
  return JSON.parse(inflated) as unknown;
}

function buildBasePacket(input: BaseSerializerInput): ContextPacket {
  return {
    packetId: input.id,
    schemaVersion: "1.0.0",
    sendingTool: input.sourceAgent,
    receivingTool: input.targetAgent ?? "unknown",
    task: input.task ? { description: input.task } : {},
    workingContext: {
      mode: input.mode ?? "sync",
      routing: input.routing ?? "direct",
      timeoutSeconds: input.timeoutSeconds ?? 60,
      priority: input.priority ?? "normal",
      ...(input.tags ? { tags: input.tags } : {}),
    },
    memoryRefs: [],
    conversationSummary: input.task ?? "",
    constraints: input.requiredCapabilities ?? [],
    permissionPolicy: {},
    timestamp: input.createdAt,
    compressed: false,
  };
}

export function serializeClaudeCodeContext(input: ClaudeCodeSerializerInput): ContextPacket {
  const basePacket = buildBasePacket(input);
  const packet: ContextPacket = {
    ...basePacket,
    workingContext: {
      ...basePacket.workingContext,
      claudeCode: {
        taskContext: input.native.taskContext,
        activeFiles: input.native.activeFiles,
        memoryMd: input.native.memoryMd,
      },
    },
  };

  return ContextPacketSchema.parse(packet);
}

export function serializeCursorContext(input: CursorSerializerInput): ContextPacket {
  const basePacket = buildBasePacket(input);
  const packet: ContextPacket = {
    ...basePacket,
    workingContext: {
      ...basePacket.workingContext,
      cursor: {
        notepads: input.native.notepads,
        editor: input.native.editor,
      },
    },
  };

  return ContextPacketSchema.parse(packet);
}

export function serializeClaudeCodeContextForTransport(
  input: ClaudeCodeSerializerInput,
  thresholdBytes = DEFAULT_PACKET_COMPRESSION_THRESHOLD_BYTES,
): ContextPacketTransport {
  return compressContextPacketForTransport(serializeClaudeCodeContext(input), thresholdBytes);
}

export function serializeCursorContextForTransport(
  input: CursorSerializerInput,
  thresholdBytes = DEFAULT_PACKET_COMPRESSION_THRESHOLD_BYTES,
): ContextPacketTransport {
  return compressContextPacketForTransport(serializeCursorContext(input), thresholdBytes);
}

function prependSummaryToMemory(summary: string, memoryMd: string): string {
  if (!summary.trim()) {
    return memoryMd;
  }

  return `## Handoff Summary\n${summary}\n\n${memoryMd}`;
}

export function deserializeClaudeCodeContext(
  packet: unknown,
  options: DeserializeContextSecurityOptions,
): ClaudeCodeDeserializerOutput {
  const decompressed = decompressContextPacketForValidation(packet);
  const validated = validateIncomingContextPacket(
    decompressed,
    options.policy,
    options.logRejection,
  );
  if (!validated.valid || !validated.packet) {
    throw new Error(`Context packet rejected: ${validated.reasons.join("; ")}`);
  }

  const parsed = ContextPacketSchema.parse(validated.packet);
  const claudeCode = parsed.workingContext["claudeCode"] as
    | ClaudeCodeSerializerInput["native"]
    | undefined;

  if (!claudeCode) {
    throw new Error("Context packet is missing workingContext.claudeCode payload");
  }

  return {
    native: claudeCode,
    memoryWrite: {
      filePath: "MEMORY.md",
      mode: "prepend",
      content: prependSummaryToMemory(parsed.conversationSummary, claudeCode.memoryMd),
    },
  };
}

export function deserializeCursorContext(
  packet: unknown,
  options: DeserializeContextSecurityOptions,
): CursorDeserializerOutput {
  const decompressed = decompressContextPacketForValidation(packet);
  const validated = validateIncomingContextPacket(
    decompressed,
    options.policy,
    options.logRejection,
  );
  if (!validated.valid || !validated.packet) {
    throw new Error(`Context packet rejected: ${validated.reasons.join("; ")}`);
  }

  const parsed = ContextPacketSchema.parse(validated.packet);
  const cursor = parsed.workingContext["cursor"] as CursorSerializerInput["native"] | undefined;

  if (!cursor) {
    throw new Error("Context packet is missing workingContext.cursor payload");
  }

  return {
    native: cursor,
    actions: {
      createNotepads: cursor.notepads,
      openFiles: cursor.editor.openFiles,
      ...(cursor.editor.activeFile ? { activeFile: cursor.editor.activeFile } : {}),
    },
  };
}
