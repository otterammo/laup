import {
  type ContextPacket,
  ContextPacketSchema,
  type HandoffMode,
  type HandoffRouting,
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
