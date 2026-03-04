import { describe, expect, it } from "vitest";
import { mergeHandoffRoutingPolicy, resolveHandoffRouting } from "../handoff-routing.js";
import type { ContextPacket } from "../handoff-schema.js";

describe("handoff-routing (HAND-007)", () => {
  const packet: ContextPacket = {
    packetId: "packet-1",
    schemaVersion: "1.0.0",
    sendingTool: "codex",
    receivingTool: "router",
    task: {
      type: "code-review",
    },
    workingContext: {},
    memoryRefs: [],
    conversationSummary: "handoff",
    constraints: [],
    permissionPolicy: {},
    timestamp: "2026-01-15T10:00:00Z",
    compressed: false,
  };

  it("supports direct routing to a specific tool", () => {
    const decision = resolveHandoffRouting({
      packet,
      directTool: "claude-code",
      candidates: [
        { tool: "claude-code", available: true, estimatedCost: 0.02 },
        { tool: "copilot", available: true, estimatedCost: 0.01 },
      ],
    });

    expect(decision.routing).toBe("direct");
    expect(decision.selectedTool).toBe("claude-code");
  });

  it("policy routing prefers matching task type and lower cost among available tools", () => {
    const decision = resolveHandoffRouting({
      packet,
      policy: {
        org: {
          routing: "capability-match",
          taskTypeWeight: 100,
          costWeight: 1,
        },
      },
      candidates: [
        {
          tool: "copilot",
          available: true,
          estimatedCost: 2,
          supportedTaskTypes: ["chat"],
        },
        {
          tool: "claude-code",
          available: true,
          estimatedCost: 5,
          supportedTaskTypes: ["code-review"],
        },
      ],
    });

    expect(decision.selectedTool).toBe("claude-code");
    expect(decision.consideredTools).toEqual(["copilot", "claude-code"]);
  });

  it("ignores unavailable tools", () => {
    const decision = resolveHandoffRouting({
      packet,
      candidates: [
        {
          tool: "claude-code",
          available: false,
          estimatedCost: 1,
          supportedTaskTypes: ["code-review"],
        },
        {
          tool: "copilot",
          available: true,
          estimatedCost: 3,
          supportedTaskTypes: ["code-review"],
        },
      ],
    });

    expect(decision.selectedTool).toBe("copilot");
  });

  it("merges org/team/project policy by scope precedence", () => {
    const merged = mergeHandoffRoutingPolicy({
      org: { routing: "capability-match", costWeight: 3, taskTypeWeight: 10 },
      team: { costWeight: 2 },
      project: { costWeight: 1, defaultTool: "claude-code" },
    });

    expect(merged.routing).toBe("capability-match");
    expect(merged.costWeight).toBe(1);
    expect(merged.defaultTool).toBe("claude-code");
  });
});
