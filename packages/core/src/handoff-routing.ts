import { z } from "zod";
import type { ContextPacket, HandoffRouting } from "./handoff-schema.js";
import type { Scope } from "./scope.js";

/**
 * Runtime information about a potential handoff target.
 */
export const HandoffRoutingCandidateSchema = z.object({
  tool: z.string().min(1),
  available: z.boolean(),
  estimatedCost: z.number().nonnegative().optional(),
  supportedTaskTypes: z.array(z.string()).optional(),
});

export type HandoffRoutingCandidate = z.infer<typeof HandoffRoutingCandidateSchema>;

/**
 * Routing policy at a single scope level.
 */
export const ScopedHandoffRoutingPolicySchema = z.object({
  routing: z.enum(["direct", "round-robin", "least-loaded", "capability-match"]).optional(),
  taskTypeWeight: z.number().nonnegative().optional(),
  costWeight: z.number().nonnegative().optional(),
  defaultTool: z.string().min(1).optional(),
});

export type ScopedHandoffRoutingPolicy = z.infer<typeof ScopedHandoffRoutingPolicySchema>;

/**
 * Policy stack, merged in org -> team -> project precedence.
 */
export const HandoffRoutingPolicyConfigSchema = z.object({
  org: ScopedHandoffRoutingPolicySchema.optional(),
  team: ScopedHandoffRoutingPolicySchema.optional(),
  project: ScopedHandoffRoutingPolicySchema.optional(),
});

export type HandoffRoutingPolicyConfig = z.infer<typeof HandoffRoutingPolicyConfigSchema>;

export interface HandoffRoutingDecision {
  routing: HandoffRouting;
  selectedTool: string;
  reason: string;
  consideredTools: string[];
  scoredCandidates?: Array<{ tool: string; score: number }>;
}

export interface ResolveHandoffRoutingInput {
  packet: ContextPacket;
  candidates: HandoffRoutingCandidate[];
  directTool?: string;
  policy?: HandoffRoutingPolicyConfig;
}

const POLICY_SCOPE_ORDER: readonly Scope[] = ["org", "team", "project"] as const;

/**
 * Merge policy layers with org < team < project precedence.
 */
export function mergeHandoffRoutingPolicy(
  policy?: HandoffRoutingPolicyConfig,
): ScopedHandoffRoutingPolicy {
  const merged: ScopedHandoffRoutingPolicy = {
    routing: "capability-match",
    taskTypeWeight: 100,
    costWeight: 1,
  };

  if (!policy) return merged;

  for (const scope of POLICY_SCOPE_ORDER) {
    const scoped = policy[scope];
    if (!scoped) continue;
    Object.assign(merged, scoped);
  }

  return merged;
}

/**
 * Resolve a handoff target using either direct addressing or policy-based routing.
 */
export function resolveHandoffRouting(input: ResolveHandoffRoutingInput): HandoffRoutingDecision {
  const mergedPolicy = mergeHandoffRoutingPolicy(input.policy);
  const availableCandidates = input.candidates.filter((candidate) => candidate.available);

  if (availableCandidates.length === 0) {
    throw new Error("No available handoff candidates");
  }

  if (input.directTool ?? mergedPolicy.routing === "direct") {
    const targetTool = input.directTool ?? mergedPolicy.defaultTool;
    if (!targetTool) {
      throw new Error("Direct routing requires a target tool");
    }

    const match = availableCandidates.find((candidate) => candidate.tool === targetTool);
    if (!match) {
      throw new Error(`Direct routing target is unavailable: ${targetTool}`);
    }

    return {
      routing: "direct",
      selectedTool: targetTool,
      reason: "direct target selected",
      consideredTools: availableCandidates.map((candidate) => candidate.tool),
    };
  }

  const taskType = getTaskType(input.packet);
  const taskTypeWeight = mergedPolicy.taskTypeWeight ?? 100;
  const costWeight = mergedPolicy.costWeight ?? 1;

  const scored = availableCandidates.map((candidate) => {
    let score = 0;

    if (taskType && candidate.supportedTaskTypes?.includes(taskType)) {
      score += taskTypeWeight;
    }

    const estimatedCost = candidate.estimatedCost ?? Number.MAX_SAFE_INTEGER;
    score -= estimatedCost * costWeight;

    return { tool: candidate.tool, score };
  });

  const [best] = [...scored].sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));

  if (!best) {
    throw new Error("Unable to resolve handoff route");
  }

  return {
    routing: mergedPolicy.routing ?? "capability-match",
    selectedTool: best.tool,
    reason: taskType
      ? `policy selected best match for task type "${taskType}" and estimated cost`
      : "policy selected lowest estimated cost among available tools",
    consideredTools: availableCandidates.map((candidate) => candidate.tool),
    scoredCandidates: scored,
  };
}

function getTaskType(packet: ContextPacket): string | undefined {
  const taskType = packet.task["type"];
  return typeof taskType === "string" && taskType.length > 0 ? taskType : undefined;
}
