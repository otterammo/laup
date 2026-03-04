import { describe, expect, it } from "vitest";
import {
  serializeClaudeCodeContext,
  serializeCursorContext,
} from "../context-packet-serializers.js";
import { ContextPacketSchema } from "../handoff-schema.js";

describe("context-packet-serializers (HAND-002)", () => {
  it("serializes Claude Code native context to HAND-001 packet", () => {
    const packet = serializeClaudeCodeContext({
      id: "packet-claude-1",
      sourceAgent: "claude-code",
      targetAgent: "cursor",
      createdAt: "2026-03-04T23:10:00.000Z",
      task: "Finish HAND-002",
      native: {
        taskContext: {
          taskId: "task-42",
          objective: "Implement serializers",
          status: "running",
          notes: "Need snapshot tests",
        },
        activeFiles: ["packages/core/src/handoff-schema.ts", "MEMORY.md"],
        memoryMd: "# Memory\n- Keep scope tight",
      },
    });

    expect(ContextPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet).toMatchInlineSnapshot(`
      {
        "compressed": false,
        "constraints": [],
        "conversationSummary": "Finish HAND-002",
        "memoryRefs": [],
        "packetId": "packet-claude-1",
        "permissionPolicy": {},
        "receivingTool": "cursor",
        "schemaVersion": "1.0.0",
        "sendingTool": "claude-code",
        "task": {
          "description": "Finish HAND-002",
        },
        "timestamp": "2026-03-04T23:10:00.000Z",
        "workingContext": {
          "claudeCode": {
            "activeFiles": [
              "packages/core/src/handoff-schema.ts",
              "MEMORY.md",
            ],
            "memoryMd": "# Memory
      - Keep scope tight",
            "taskContext": {
              "notes": "Need snapshot tests",
              "objective": "Implement serializers",
              "status": "running",
              "taskId": "task-42",
            },
          },
          "mode": "sync",
          "priority": "normal",
          "routing": "direct",
          "timeoutSeconds": 60,
        },
      }
    `);
  });

  it("serializes Cursor native context to HAND-001 packet", () => {
    const packet = serializeCursorContext({
      id: "packet-cursor-1",
      sourceAgent: "cursor",
      targetAgent: "claude-code",
      createdAt: "2026-03-04T23:10:00.000Z",
      requiredCapabilities: ["handoff", "tooling"],
      native: {
        notepads: [
          {
            id: "np-1",
            title: "handoff plan",
            content: "Implement serializers and tests",
            updatedAt: "2026-03-04T23:00:00.000Z",
          },
        ],
        editor: {
          workspaceRoot: "/repo",
          openFiles: ["src/index.ts", "src/handoff.ts"],
          activeFile: "src/handoff.ts",
          selections: [
            {
              file: "src/handoff.ts",
              startLine: 10,
              endLine: 25,
            },
          ],
        },
      },
    });

    expect(ContextPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet).toMatchInlineSnapshot(`
      {
        "compressed": false,
        "constraints": [
          "handoff",
          "tooling",
        ],
        "conversationSummary": "",
        "memoryRefs": [],
        "packetId": "packet-cursor-1",
        "permissionPolicy": {},
        "receivingTool": "claude-code",
        "schemaVersion": "1.0.0",
        "sendingTool": "cursor",
        "task": {},
        "timestamp": "2026-03-04T23:10:00.000Z",
        "workingContext": {
          "cursor": {
            "editor": {
              "activeFile": "src/handoff.ts",
              "openFiles": [
                "src/index.ts",
                "src/handoff.ts",
              ],
              "selections": [
                {
                  "endLine": 25,
                  "file": "src/handoff.ts",
                  "startLine": 10,
                },
              ],
              "workspaceRoot": "/repo",
            },
            "notepads": [
              {
                "content": "Implement serializers and tests",
                "id": "np-1",
                "title": "handoff plan",
                "updatedAt": "2026-03-04T23:00:00.000Z",
              },
            ],
          },
          "mode": "sync",
          "priority": "normal",
          "routing": "direct",
          "timeoutSeconds": 60,
        },
      }
    `);
  });
});
