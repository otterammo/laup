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

function buildBasePacket(input: BaseSerializerInput): Omit<ContextPacket, "state"> {
  return {
    id: input.id,
    schemaVersion: "1.0",
    sourceAgent: input.sourceAgent,
    ...(input.targetAgent ? { targetAgent: input.targetAgent } : {}),
    mode: input.mode ?? "sync",
    routing: input.routing ?? "direct",
    timeoutSeconds: input.timeoutSeconds ?? 60,
    ...(input.task
      ? {
          conversation: {
            messages: [],
            task: input.task,
          },
        }
      : {}),
    ...(input.requiredCapabilities
      ? {
          requiredCapabilities: input.requiredCapabilities,
        }
      : {}),
    compressed: false,
    metadata: {
      createdAt: input.createdAt,
      priority: input.priority ?? "normal",
      ...(input.tags ? { tags: input.tags } : {}),
    },
  };
}

export function serializeClaudeCodeContext(input: ClaudeCodeSerializerInput): ContextPacket {
  const packet: ContextPacket = {
    ...buildBasePacket(input),
    state: {
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
  const packet: ContextPacket = {
    ...buildBasePacket(input),
    state: {
      cursor: {
        notepads: input.native.notepads,
        editor: input.native.editor,
      },
    },
  };

  return ContextPacketSchema.parse(packet);
}
