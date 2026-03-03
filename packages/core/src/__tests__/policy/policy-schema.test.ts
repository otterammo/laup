import { describe, expect, it } from "vitest";
import {
  matchesGlob,
  matchesRule,
  PolicyDocumentSchema,
  validatePolicyDocument,
  validatePolicyJson,
} from "../../policy/index.js";

describe("policy canonical schema/matcher", () => {
  it("validates a canonical policy document", () => {
    const doc = {
      version: "v1",
      rules: [
        {
          id: "r1",
          effect: "allow",
          action: "tool:run",
          resource: "tool://codex/*",
          scope: "org",
          scopeId: "org-1",
          conditions: [{ field: "actor.role", operator: "eq", value: "dev" }],
        },
      ],
    };

    const parsed = PolicyDocumentSchema.parse(doc);
    expect(parsed.rules).toHaveLength(1);
  });

  it("matches glob patterns for action/resource", () => {
    expect(matchesGlob("tool:*", "tool:run")).toBe(true);
    expect(matchesGlob("tool://codex/*", "tool://codex/chat")).toBe(true);
    expect(matchesGlob("tool://copilot/*", "tool://codex/chat")).toBe(false);
  });

  it("matches a rule with scope + conditions", () => {
    const rule = {
      id: "r1",
      effect: "allow" as const,
      action: "tool:*",
      resource: "tool://codex/*",
      scope: "org" as const,
      scopeId: "org-1",
      conditions: [{ field: "actor.role", operator: "eq" as const, value: "dev" }],
    };

    const matched = matchesRule(rule, {
      action: "tool:run",
      resource: "tool://codex/chat",
      scope: "org",
      scopeId: "org-1",
      attributes: { "actor.role": "dev" },
    });

    expect(matched).toBe(true);
  });

  it("validates JSON policy documents", () => {
    const result = validatePolicyJson(
      JSON.stringify({
        version: "v1",
        rules: [
          {
            id: "r1",
            effect: "deny",
            action: "exec:*",
            resource: "file://secrets/*",
            scope: "project",
            scopeId: "proj-1",
          },
        ],
      }),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects invalid policy docs", () => {
    const result = validatePolicyDocument({ version: "v1", rules: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
