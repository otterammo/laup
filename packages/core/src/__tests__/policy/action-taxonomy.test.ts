import { describe, expect, it } from "vitest";
import {
  createActionTaxonomyIndex,
  createEvaluationContext,
  type Policy,
  PolicyEvaluator,
  resolveTaxonomyActionMatches,
  validateActionTaxonomy,
} from "../../policy/index.js";

describe("action taxonomy", () => {
  const taxonomy = {
    nodes: [
      { id: "repo", inheritsToChildren: true },
      { id: "repo.read", parentId: "repo" },
      { id: "repo.write", parentId: "repo" },
      { id: "repo.write.force", parentId: "repo.write" },
      { id: "admin", inheritsToChildren: false },
      { id: "admin.delete", parentId: "admin" },
    ],
  };

  it("validates a taxonomy with unique ids and no cycles", () => {
    const result = validateActionTaxonomy(taxonomy);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects duplicate ids", () => {
    const result = validateActionTaxonomy({
      nodes: [{ id: "repo" }, { id: "repo" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate action taxonomy id"))).toBe(true);
  });

  it("rejects cycles", () => {
    const result = validateActionTaxonomy({
      nodes: [
        { id: "a", parentId: "c" },
        { id: "b", parentId: "a" },
        { id: "c", parentId: "b" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("rejects unknown parent ids", () => {
    const result = validateActionTaxonomy({
      nodes: [{ id: "repo.read", parentId: "repo" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unknown parentId"))).toBe(true);
  });

  it("resolves descendant matches when inheritance is enabled", () => {
    const index = createActionTaxonomyIndex(taxonomy);

    expect(resolveTaxonomyActionMatches("repo.write.force", "repo", index)).toBe(true);
    expect(resolveTaxonomyActionMatches("admin.delete", "admin", index)).toBe(false);
  });

  it("integrates with policy evaluator for inherited allow/deny semantics", () => {
    const evaluator = new PolicyEvaluator({ actionTaxonomy: taxonomy });

    const context = createEvaluationContext(
      { id: "user-1", type: "user" },
      "repo.write.force",
      { type: "repository" },
      [
        { scope: "user", id: "user-1" },
        { scope: "project", id: "proj-1" },
        { scope: "team", id: "team-1" },
        { scope: "org", id: "org-1" },
      ],
    );

    const policies: Policy[] = [
      {
        id: "org-allow-repo",
        name: "Allow repo actions",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["repo"],
        resourceTypes: ["*"],
      },
      {
        id: "project-deny-force",
        name: "Block force push",
        scope: "project",
        scopeId: "proj-1",
        effect: "deny",
        actions: ["repo.write.force"],
        resourceTypes: ["*"],
      },
    ];

    const result = evaluator.evaluate(context, policies);

    expect(result.allowed).toBe(false);
    expect(result.effect).toBe("deny");
    expect(result.reason.matchedPolicyId).toBe("project-deny-force");
    expect(result.reason.allowCount).toBe(1);
    expect(result.reason.denyCount).toBe(1);
  });

  it("does not apply parent match when inheritance flag is disabled", () => {
    const evaluator = new PolicyEvaluator({ actionTaxonomy: taxonomy });
    const context = createEvaluationContext(
      { id: "user-1", type: "user" },
      "admin.delete",
      { type: "repository" },
      [{ scope: "org", id: "org-1" }],
    );

    const result = evaluator.evaluate(context, [
      {
        id: "org-allow-admin-parent",
        name: "Allow admin parent only",
        scope: "org",
        scopeId: "org-1",
        effect: "allow",
        actions: ["admin"],
        resourceTypes: ["*"],
      },
    ]);

    expect(result.allowed).toBe(false);
    expect(result.reason.usedDefault).toBe(true);
  });
});
