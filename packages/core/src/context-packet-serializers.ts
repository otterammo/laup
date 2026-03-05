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

function prependSummaryToMemory(summary: string, memoryMd: string): string {
  if (!summary.trim()) {
    return memoryMd;
  }

  return `## Handoff Summary\n${summary}\n\n${memoryMd}`;
}

export function deserializeClaudeCodeContext(packet: ContextPacket): ClaudeCodeDeserializerOutput {
  const parsed = ContextPacketSchema.parse(packet);
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

export function deserializeCursorContext(packet: ContextPacket): CursorDeserializerOutput {
  const parsed = ContextPacketSchema.parse(packet);
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
