import { describe, expect, it } from "vitest";
import {
  type AuthIdentity,
  createEvaluationContext,
  createIdentityRolePolicies,
  createRolePolicies,
  type EvaluationContext,
  PolicyEvaluator,
  resolveBuiltInRoles,
  resolveIdentityRoles,
  type ScopeChainEntry,
} from "../../index.js";

describe("RBAC (PERM-003)", () => {
  const createScopeChain = (): ScopeChainEntry[] => [
    { scope: "user", id: "user-1" },
    { scope: "project", id: "proj-1" },
    { scope: "team", id: "team-1" },
    { scope: "org", id: "org-1" },
  ];

  const createContext = (action: string): EvaluationContext =>
    createEvaluationContext(
      { id: "user-1", type: "user" },
      action,
      { type: "document" },
      createScopeChain(),
    );

  describe("role resolution", () => {
    it("normalizes, filters, de-duplicates, and sorts roles deterministically", () => {
      const resolved = resolveBuiltInRoles([" Admin", "viewer", "OWNER", "admin", "unknown"]);
      expect(resolved).toEqual(["viewer", "admin", "owner"]);
    });

    it("resolves roles from auth identity", () => {
      const identity: AuthIdentity = {
        id: "user-1",
        type: "user",
        roles: ["EDITOR", "viewer", "editor"],
        scopes: [],
      };

      expect(resolveIdentityRoles(identity)).toEqual(["viewer", "editor"]);
    });
  });

  describe("role -> policy mapping", () => {
    it("creates deterministic policy IDs and allow rules", () => {
      const policies = createRolePolicies(["editor", "viewer"], {
        scope: "user",
        scopeId: "user-1",
      });

      expect(policies.map((p) => p.id)).toEqual([
        "rbac:user:user-1:viewer",
        "rbac:user:user-1:editor",
      ]);
      expect(policies.every((p) => p.effect === "allow")).toBe(true);
    });

    it("creates identity-scoped policies by default", () => {
      const policies = createIdentityRolePolicies({
        id: "user-123",
        roles: ["viewer"],
      });

      expect(policies[0]?.scope).toBe("user");
      expect(policies[0]?.scopeId).toBe("user-123");
    });
  });

  describe("allow/deny behavior by role", () => {
    const evaluate = (roles: string[], action: string) => {
      const evaluator = new PolicyEvaluator();
      const context = createContext(action);
      const policies = createRolePolicies(roles, {
        scope: "user",
        scopeId: "user-1",
      });
      return evaluator.evaluate(context, policies);
    };

    it("viewer: allows read, denies write", () => {
      expect(evaluate(["viewer"], "read").allowed).toBe(true);
      expect(evaluate(["viewer"], "write").allowed).toBe(false);
    });

    it("editor: allows write, denies delete", () => {
      expect(evaluate(["editor"], "write").allowed).toBe(true);
      expect(evaluate(["editor"], "delete").allowed).toBe(false);
    });

    it("admin: allows delete and admin", () => {
      expect(evaluate(["admin"], "delete").allowed).toBe(true);
      expect(evaluate(["admin"], "admin").allowed).toBe(true);
    });

    it("owner: allows everything", () => {
      expect(evaluate(["owner"], "read").allowed).toBe(true);
      expect(evaluate(["owner"], "write").allowed).toBe(true);
      expect(evaluate(["owner"], "delete").allowed).toBe(true);
      expect(evaluate(["owner"], "super-admin-action").allowed).toBe(true);
    });
  });

  describe("interaction with policy evaluator", () => {
    it("org deny overrides RBAC role allow due to scope priority", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("write");

      const rolePolicies = createRolePolicies(["editor"], {
        scope: "user",
        scopeId: "user-1",
      });

      const result = evaluator.evaluate(context, [
        ...rolePolicies,
        {
          id: "org-deny-write",
          name: "Org deny write",
          scope: "org",
          scopeId: "org-1",
          effect: "deny",
          actions: ["write"],
          resourceTypes: ["*"],
        },
      ]);

      expect(result.allowed).toBe(false);
      expect(result.reason.matchedPolicyId).toBe("org-deny-write");
    });

    it("additional allow policies can grant actions not in RBAC role", () => {
      const evaluator = new PolicyEvaluator();
      const context = createContext("delete");

      const rolePolicies = createRolePolicies(["viewer"], {
        scope: "user",
        scopeId: "user-1",
      });

      const result = evaluator.evaluate(context, [
        ...rolePolicies,
        {
          id: "project-allow-delete",
          name: "Project allow delete",
          scope: "project",
          scopeId: "proj-1",
          effect: "allow",
          actions: ["delete"],
          resourceTypes: ["*"],
        },
      ]);

      expect(result.allowed).toBe(true);
      expect(result.reason.matchedPolicyId).toBe("project-allow-delete");
    });
  });
});
