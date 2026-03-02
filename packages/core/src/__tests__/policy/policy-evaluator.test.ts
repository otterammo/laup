import { describe, expect, it } from "vitest";
import {
  createEvaluationContext,
  createFailClosedEvaluator,
  createFailOpenEvaluator,
  type EvaluationContext,
  type Policy,
  PolicyEvaluator,
  type ScopeChainEntry,
} from "../../policy/index.js";

describe("PolicyEvaluator", () => {
  // Helper to create a basic scope chain
  const createScopeChain = (overrides: Partial<Record<string, string>> = {}): ScopeChainEntry[] => [
    { scope: "user", id: overrides.user ?? "user-1" },
    { scope: "project", id: overrides.project ?? "proj-1" },
    { scope: "team", id: overrides.team ?? "team-1" },
    { scope: "org", id: overrides.org ?? "org-1" },
  ];

  // Helper to create a basic context
  const createContext = (
    action = "read",
    resourceType = "document",
    scopeChain = createScopeChain(),
  ): EvaluationContext =>
    createEvaluationContext(
      { id: "user-1", type: "user" },
      action,
      { type: resourceType },
      scopeChain,
    );

  // Helper to create a basic policy
  const createPolicy = (overrides: Partial<Policy>): Policy => ({
    id: overrides.id ?? "policy-1",
    name: overrides.name ?? "Test Policy",
    scope: overrides.scope ?? "org",
    scopeId: overrides.scopeId ?? "org-1",
    effect: overrides.effect ?? "allow",
    actions: overrides.actions ?? ["*"],
    resourceTypes: overrides.resourceTypes ?? ["*"],
    ...overrides,
  });

  describe("default effect", () => {
    it("defaults to fail-closed (deny) when no policies match", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const result = evaluator.evaluate(context, []);

      expect(result.allowed).toBe(false);
      expect(result.effect).toBe("deny");
      expect(result.reason.usedDefault).toBe(true);
    });

    it("respects fail-open configuration when no policies match", () => {
      const evaluator = new PolicyEvaluator({ defaultEffect: "allow" });
      const context = createContext();

      const result = evaluator.evaluate(context, []);

      expect(result.allowed).toBe(true);
      expect(result.effect).toBe("allow");
      expect(result.reason.usedDefault).toBe(true);
    });

    it("provides defaultEffect getter", () => {
      const failClosed = new PolicyEvaluator({ defaultEffect: "deny" });
      const failOpen = new PolicyEvaluator({ defaultEffect: "allow" });

      expect(failClosed.defaultEffect).toBe("deny");
      expect(failOpen.defaultEffect).toBe("allow");
    });
  });

  describe("factory functions", () => {
    it("createFailClosedEvaluator creates deny-by-default evaluator", () => {
      const evaluator = createFailClosedEvaluator();
      const context = createContext();

      const result = evaluator.evaluate(context, []);

      expect(result.allowed).toBe(false);
      expect(result.effect).toBe("deny");
    });

    it("createFailOpenEvaluator creates allow-by-default evaluator", () => {
      const evaluator = createFailOpenEvaluator();
      const context = createContext();

      const result = evaluator.evaluate(context, []);

      expect(result.allowed).toBe(true);
      expect(result.effect).toBe("allow");
    });
  });

  describe("effect priority: deny > allow", () => {
    it("explicit deny takes precedence over explicit allow at same scope", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "allow-1", effect: "allow", scope: "org", scopeId: "org-1" }),
        createPolicy({ id: "deny-1", effect: "deny", scope: "org", scopeId: "org-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.effect).toBe("deny");
      expect(result.reason.matchedPolicyId).toBe("deny-1");
      expect(result.reason.denyCount).toBe(1);
      expect(result.reason.allowCount).toBe(1);
    });

    it("deny from lower scope blocks allow from same scope", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "allow-1", effect: "allow", scope: "project", scopeId: "proj-1" }),
        createPolicy({ id: "deny-1", effect: "deny", scope: "project", scopeId: "proj-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.effect).toBe("deny");
    });

    it("multiple denies all contribute to result", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "deny-1", effect: "deny", scope: "org", scopeId: "org-1" }),
        createPolicy({ id: "deny-2", effect: "deny", scope: "team", scopeId: "team-1" }),
        createPolicy({ id: "allow-1", effect: "allow", scope: "project", scopeId: "proj-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.reason.denyCount).toBe(2);
      expect(result.reason.allowCount).toBe(1);
      expect(result.reason.allMatchedPolicyIds).toContain("deny-1");
      expect(result.reason.allMatchedPolicyIds).toContain("deny-2");
    });
  });

  describe("scope priority: org > team > project > user", () => {
    it("org-level deny overrides project-level allow", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "proj-allow", effect: "allow", scope: "project", scopeId: "proj-1" }),
        createPolicy({ id: "org-deny", effect: "deny", scope: "org", scopeId: "org-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.reason.matchedPolicyId).toBe("org-deny");
      expect(result.reason.matchedScope).toBe("org");
    });

    it("team-level deny overrides user-level allow", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "user-allow", effect: "allow", scope: "user", scopeId: "user-1" }),
        createPolicy({ id: "team-deny", effect: "deny", scope: "team", scopeId: "team-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.reason.matchedPolicyId).toBe("team-deny");
      expect(result.reason.matchedScope).toBe("team");
    });

    it("higher scope allow takes precedence when all policies allow", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "user-allow", effect: "allow", scope: "user", scopeId: "user-1" }),
        createPolicy({ id: "org-allow", effect: "allow", scope: "org", scopeId: "org-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(true);
      expect(result.reason.matchedPolicyId).toBe("org-allow");
      expect(result.reason.matchedScope).toBe("org");
    });

    it("respects full scope priority chain", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      // All scopes allow, org should be reported as the match
      const policies: Policy[] = [
        createPolicy({ id: "user-allow", effect: "allow", scope: "user", scopeId: "user-1" }),
        createPolicy({ id: "proj-allow", effect: "allow", scope: "project", scopeId: "proj-1" }),
        createPolicy({ id: "team-allow", effect: "allow", scope: "team", scopeId: "team-1" }),
        createPolicy({ id: "org-allow", effect: "allow", scope: "org", scopeId: "org-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(true);
      expect(result.reason.matchedPolicyId).toBe("org-allow");
      expect(result.reason.matchedScope).toBe("org");
      expect(result.reason.allMatchedPolicyIds).toHaveLength(4);
    });
  });

  describe("policy priority within same scope", () => {
    it("higher priority policy is evaluated first", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({
          id: "low-priority",
          effect: "allow",
          scope: "org",
          scopeId: "org-1",
          priority: 10,
        }),
        createPolicy({
          id: "high-priority",
          effect: "allow",
          scope: "org",
          scopeId: "org-1",
          priority: 100,
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      // Both match, but high-priority should be the "winner"
      expect(result.reason.matchedPolicyId).toBe("high-priority");
    });

    it("default priority is 0", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({
          id: "explicit-zero",
          effect: "allow",
          scope: "org",
          scopeId: "org-1",
          priority: 0,
        }),
        createPolicy({ id: "no-priority", effect: "allow", scope: "org", scopeId: "org-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      // Both should match with equal priority
      expect(result.reason.allowCount).toBe(2);
    });
  });

  describe("policy matching", () => {
    it("matches policies in scope chain", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "match", scope: "org", scopeId: "org-1" }),
        createPolicy({ id: "no-match", scope: "org", scopeId: "other-org" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(true);
      expect(result.reason.allMatchedPolicyIds).toEqual(["match"]);
    });

    it("ignores disabled policies", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "disabled", effect: "allow", enabled: false }),
        createPolicy({ id: "enabled", effect: "deny", enabled: true }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.reason.allMatchedPolicyIds).toEqual(["enabled"]);
    });

    it("treats missing enabled as true", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [createPolicy({ id: "no-enabled-field", effect: "allow" })];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(true);
      expect(result.reason.allMatchedPolicyIds).toEqual(["no-enabled-field"]);
    });
  });

  describe("action matching", () => {
    it("matches exact action", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("read");

      const policies: Policy[] = [
        createPolicy({ id: "match", actions: ["read"] }),
        createPolicy({ id: "no-match", actions: ["write"] }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["match"]);
    });

    it("matches wildcard action", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("delete");

      const policies: Policy[] = [createPolicy({ id: "wildcard", actions: ["*"] })];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["wildcard"]);
    });

    it("matches prefix wildcard", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("document:read");

      const policies: Policy[] = [createPolicy({ id: "prefix", actions: ["document:*"] })];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["prefix"]);
    });

    it("matches suffix wildcard", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("admin:delete");

      const policies: Policy[] = [createPolicy({ id: "suffix", actions: ["*:delete"] })];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["suffix"]);
    });

    it("matches any action in list", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("update");

      const policies: Policy[] = [
        createPolicy({ id: "multi", actions: ["read", "update", "delete"] }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["multi"]);
    });
  });

  describe("resource type matching", () => {
    it("matches exact resource type", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("read", "document");

      const policies: Policy[] = [
        createPolicy({ id: "match", resourceTypes: ["document"] }),
        createPolicy({ id: "no-match", resourceTypes: ["skill"] }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["match"]);
    });

    it("matches wildcard resource type", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("read", "anything");

      const policies: Policy[] = [createPolicy({ id: "wildcard", resourceTypes: ["*"] })];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["wildcard"]);
    });
  });

  describe("conditions", () => {
    it("eq operator matches equal values", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.actor.type = "admin";

      const policies: Policy[] = [
        createPolicy({
          id: "admin-only",
          conditions: [{ field: "actor.type", operator: "eq", value: "admin" }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["admin-only"]);
    });

    it("eq operator rejects non-equal values", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.actor.type = "user";

      const policies: Policy[] = [
        createPolicy({
          id: "admin-only",
          conditions: [{ field: "actor.type", operator: "eq", value: "admin" }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual([]);
    });

    it("neq operator matches non-equal values", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.actor.type = "user";

      const policies: Policy[] = [
        createPolicy({
          id: "not-guest",
          conditions: [{ field: "actor.type", operator: "neq", value: "guest" }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["not-guest"]);
    });

    it("in operator matches value in list", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.actor.type = "admin";

      const policies: Policy[] = [
        createPolicy({
          id: "elevated",
          conditions: [{ field: "actor.type", operator: "in", value: ["admin", "superuser"] }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["elevated"]);
    });

    it("nin operator matches value not in list", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.actor.type = "user";

      const policies: Policy[] = [
        createPolicy({
          id: "not-elevated",
          conditions: [{ field: "actor.type", operator: "nin", value: ["admin", "superuser"] }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["not-elevated"]);
    });

    it("contains operator checks array membership", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.actor.attributes = { roles: ["editor", "viewer"] };

      const policies: Policy[] = [
        createPolicy({
          id: "has-editor",
          conditions: [{ field: "actor.attributes.roles", operator: "contains", value: "editor" }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["has-editor"]);
    });

    it("exists operator checks field presence", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.environment = { requestId: "req-123" };

      const policies: Policy[] = [
        createPolicy({
          id: "has-request-id",
          conditions: [{ field: "environment.requestId", operator: "exists", value: true }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["has-request-id"]);
    });

    it("exists operator checks field absence", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({
          id: "no-env",
          conditions: [{ field: "environment.debug", operator: "exists", value: false }],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["no-env"]);
    });

    it("all conditions must match (AND logic)", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("write");
      context.actor.type = "admin";

      const policies: Policy[] = [
        createPolicy({
          id: "admin-write",
          conditions: [
            { field: "actor.type", operator: "eq", value: "admin" },
            { field: "action", operator: "eq", value: "write" },
          ],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["admin-write"]);
    });

    it("fails if any condition does not match", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("read"); // action is read, not write
      context.actor.type = "admin";

      const policies: Policy[] = [
        createPolicy({
          id: "admin-write",
          conditions: [
            { field: "actor.type", operator: "eq", value: "admin" },
            { field: "action", operator: "eq", value: "write" }, // This won't match
          ],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual([]);
    });

    it("handles deeply nested field paths", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      context.resource.attributes = {
        metadata: {
          owner: {
            id: "user-1",
          },
        },
      };

      const policies: Policy[] = [
        createPolicy({
          id: "owner-match",
          conditions: [
            { field: "resource.attributes.metadata.owner.id", operator: "eq", value: "user-1" },
          ],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual(["owner-match"]);
    });

    it("handles missing nested fields gracefully", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      // No attributes set

      const policies: Policy[] = [
        createPolicy({
          id: "owner-match",
          conditions: [
            { field: "resource.attributes.metadata.owner.id", operator: "eq", value: "user-1" },
          ],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason.allMatchedPolicyIds).toEqual([]);
    });
  });

  describe("evaluation consistency and determinism", () => {
    it("produces same result for same input", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();
      const policies: Policy[] = [
        createPolicy({ id: "p1", effect: "allow", scope: "org", scopeId: "org-1" }),
        createPolicy({ id: "p2", effect: "deny", scope: "team", scopeId: "team-1" }),
      ];

      const result1 = evaluator.evaluate(context, policies);
      const result2 = evaluator.evaluate(context, policies);
      const result3 = evaluator.evaluate(context, policies);

      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it("policy order in input does not affect result", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policy1 = createPolicy({ id: "p1", effect: "allow", scope: "user", scopeId: "user-1" });
      const policy2 = createPolicy({ id: "p2", effect: "deny", scope: "org", scopeId: "org-1" });

      const result1 = evaluator.evaluate(context, [policy1, policy2]);
      const result2 = evaluator.evaluate(context, [policy2, policy1]);

      expect(result1.allowed).toBe(result2.allowed);
      expect(result1.effect).toBe(result2.effect);
      expect(result1.reason.matchedPolicyId).toBe(result2.reason.matchedPolicyId);
    });
  });

  describe("evaluation reason details", () => {
    it("provides complete reason for deny", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "deny-policy", effect: "deny", scope: "org", scopeId: "org-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason).toEqual({
        matchedPolicyId: "deny-policy",
        matchedEffect: "deny",
        matchedScope: "org",
        denyCount: 1,
        allowCount: 0,
        usedDefault: false,
        allMatchedPolicyIds: ["deny-policy"],
      });
    });

    it("provides complete reason for allow", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext();

      const policies: Policy[] = [
        createPolicy({ id: "allow-policy", effect: "allow", scope: "team", scopeId: "team-1" }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.reason).toEqual({
        matchedPolicyId: "allow-policy",
        matchedEffect: "allow",
        matchedScope: "team",
        denyCount: 0,
        allowCount: 1,
        usedDefault: false,
        allMatchedPolicyIds: ["allow-policy"],
      });
    });

    it("provides reason for default deny", () => {
      const evaluator = new PolicyEvaluator({ defaultEffect: "deny" });
      const context = createContext();

      const result = evaluator.evaluate(context, []);

      expect(result.reason).toEqual({
        denyCount: 0,
        allowCount: 0,
        usedDefault: true,
        allMatchedPolicyIds: [],
      });
    });

    it("provides reason for default allow", () => {
      const evaluator = new PolicyEvaluator({ defaultEffect: "allow" });
      const context = createContext();

      const result = evaluator.evaluate(context, []);

      expect(result.reason).toEqual({
        denyCount: 0,
        allowCount: 0,
        usedDefault: true,
        allMatchedPolicyIds: [],
      });
    });
  });

  describe("createEvaluationContext helper", () => {
    it("creates valid context with required fields", () => {
      const context = createEvaluationContext(
        { id: "actor-1", type: "service" },
        "execute",
        { type: "skill", id: "skill-1" },
        [{ scope: "org", id: "org-1" }],
      );

      expect(context.actor).toEqual({ id: "actor-1", type: "service" });
      expect(context.action).toBe("execute");
      expect(context.resource).toEqual({ type: "skill", id: "skill-1" });
      expect(context.scopeChain).toEqual([{ scope: "org", id: "org-1" }]);
    });
  });

  describe("complex real-world scenarios", () => {
    it("org blocks action, project cannot override", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("delete");

      const policies: Policy[] = [
        // Org says: no deletes allowed
        createPolicy({
          id: "org-no-delete",
          effect: "deny",
          scope: "org",
          scopeId: "org-1",
          actions: ["delete"],
        }),
        // Project tries to allow deletes
        createPolicy({
          id: "proj-allow-delete",
          effect: "allow",
          scope: "project",
          scopeId: "proj-1",
          actions: ["delete"],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.reason.matchedScope).toBe("org");
    });

    it("allows action when only lower scope permits", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("read");

      const policies: Policy[] = [
        // Only project-level allows read
        createPolicy({
          id: "proj-allow-read",
          effect: "allow",
          scope: "project",
          scopeId: "proj-1",
          actions: ["read"],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(true);
    });

    it("handles mixed scope and priority correctly", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("admin");

      const policies: Policy[] = [
        // High priority team allow
        createPolicy({
          id: "team-allow",
          effect: "allow",
          scope: "team",
          scopeId: "team-1",
          priority: 100,
        }),
        // Low priority org deny
        createPolicy({
          id: "org-deny",
          effect: "deny",
          scope: "org",
          scopeId: "org-1",
          priority: 1,
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      // Org scope takes priority over team scope, regardless of policy priority
      expect(result.allowed).toBe(false);
      expect(result.reason.matchedScope).toBe("org");
    });

    it("fails closed when no matching policies for specific action", () => {
      const evaluator = new PolicyEvaluator({ defaultEffect: "deny" });
      const context = createContext("super-admin-action");

      const policies: Policy[] = [
        // Only allows read/write, not the requested action
        createPolicy({
          id: "basic-ops",
          effect: "allow",
          actions: ["read", "write"],
        }),
      ];

      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(false);
      expect(result.reason.usedDefault).toBe(true);
    });

    it("condition-based role check with scope priority", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("admin");
      context.actor.attributes = { roles: ["editor"] };

      const policies: Policy[] = [
        // Org: Only admins can do admin actions
        createPolicy({
          id: "org-admin-only",
          effect: "deny",
          scope: "org",
          scopeId: "org-1",
          actions: ["admin"],
          conditions: [{ field: "actor.attributes.roles", operator: "contains", value: "admin" }],
        }),
        // Project: Editors can do admin in this project
        createPolicy({
          id: "proj-editor-admin",
          effect: "allow",
          scope: "project",
          scopeId: "proj-1",
          actions: ["admin"],
          conditions: [{ field: "actor.attributes.roles", operator: "contains", value: "editor" }],
        }),
      ];

      // The org deny doesn't match (user doesn't have admin role in condition)
      // The project allow matches (user has editor role)
      const result = evaluator.evaluate(context, policies);

      expect(result.allowed).toBe(true);
      expect(result.reason.matchedPolicyId).toBe("proj-editor-admin");
    });
  });
});
