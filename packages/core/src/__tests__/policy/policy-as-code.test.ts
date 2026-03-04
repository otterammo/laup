import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyPolicyDeploymentPlan,
  createPolicyDeploymentPlan,
  formatPolicyPlanForCi,
  loadPolicyDocumentsFromPaths,
  mergePolicyDocuments,
} from "../../policy/index.js";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "laup-policy-as-code-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map(async (dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("policy-as-code workflow", () => {
  it("loads policy documents from repository paths and validates them", async () => {
    const dir = await createTempDir();
    await fs.writeFile(
      path.join(dir, "policy-a.json"),
      JSON.stringify({
        version: "v1",
        rules: [
          {
            id: "allow-tool",
            effect: "allow",
            action: "tool:run",
            resource: "tool://codex/chat",
            scope: "org",
            scopeId: "org-1",
            conditions: [],
          },
        ],
      }),
    );
    await fs.writeFile(path.join(dir, "broken.json"), JSON.stringify({ version: "v1", rules: [] }));

    const result = await loadPolicyDocumentsFromPaths([dir]);

    expect(result.validDocuments).toHaveLength(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.documents.map((doc) => path.basename(doc.path))).toEqual([
      "broken.json",
      "policy-a.json",
    ]);
  });

  it("creates deterministic plan and preserves non-destructive dry-run apply", () => {
    const current = {
      version: "v1",
      rules: [
        {
          id: "rule-a",
          effect: "allow" as const,
          action: "tool:run",
          resource: "tool://codex/chat",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
        {
          id: "rule-c",
          effect: "deny" as const,
          action: "exec:*",
          resource: "file://secrets/*",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
      ],
    };

    const candidate = {
      version: "v1",
      rules: [
        {
          id: "rule-b",
          effect: "allow" as const,
          action: "memory:read",
          resource: "memory://shared/*",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
        {
          id: "rule-a",
          effect: "deny" as const,
          action: "tool:run",
          resource: "tool://codex/chat",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
      ],
    };

    const plan = createPolicyDeploymentPlan({ current, candidate, dryRun: true });

    expect(plan.ok).toBe(true);
    expect(plan.changes.map((change) => `${change.type}:${change.id}`)).toEqual([
      "update:rule-a",
      "add:rule-b",
      "remove:rule-c",
    ]);
    expect(plan.summary).toEqual({ add: 1, update: 1, remove: 1, unchanged: 0 });

    const dryRunApply = applyPolicyDeploymentPlan(plan);
    expect(dryRunApply.ok).toBe(true);
    expect(dryRunApply.applied).toBe(false);
    expect(dryRunApply.document).toEqual(plan.current);
  });

  it("blocks plan/apply on validation failures and duplicate IDs", () => {
    const current = {
      version: "v1",
      rules: [
        {
          id: "rule-1",
          effect: "allow" as const,
          action: "tool:run",
          resource: "tool://codex/chat",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
      ],
    };

    const invalidCandidate = {
      version: "v1",
      rules: [],
    };

    const invalidPlan = createPolicyDeploymentPlan({
      current,
      candidate: invalidCandidate,
      dryRun: false,
    });

    expect(invalidPlan.ok).toBe(false);
    const appliedInvalid = applyPolicyDeploymentPlan(invalidPlan);
    expect(appliedInvalid.ok).toBe(false);
    expect(appliedInvalid.applied).toBe(false);

    const duplicateCandidate = {
      version: "v1",
      rules: [
        {
          id: "dup",
          effect: "allow" as const,
          action: "tool:run",
          resource: "tool://codex/chat",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
        {
          id: "dup",
          effect: "deny" as const,
          action: "exec:*",
          resource: "file://*",
          scope: "org" as const,
          scopeId: "org-1",
          conditions: [],
        },
      ],
    };

    const duplicatePlan = createPolicyDeploymentPlan({
      current,
      candidate: duplicateCandidate,
      dryRun: false,
    });
    expect(duplicatePlan.ok).toBe(false);
    expect(duplicatePlan.errors.join("\n")).toContain("duplicate rule ids");
  });

  it("merges documents and emits CI-friendly output", () => {
    const merged = mergePolicyDocuments([
      {
        version: "v1",
        rules: [
          {
            id: "rule-2",
            effect: "allow" as const,
            action: "tool:run",
            resource: "tool://codex/*",
            scope: "org" as const,
            scopeId: "org-1",
            conditions: [],
          },
        ],
      },
      {
        version: "v1",
        rules: [
          {
            id: "rule-1",
            effect: "deny" as const,
            action: "exec:*",
            resource: "file://secrets/*",
            scope: "org" as const,
            scopeId: "org-1",
            conditions: [],
          },
        ],
      },
    ]);

    expect(merged.rules.map((rule) => rule.id)).toEqual(["rule-1", "rule-2"]);

    const plan = createPolicyDeploymentPlan({
      current: { version: "v1", rules: [merged.rules[0]!] },
      candidate: merged,
      dryRun: true,
    });

    const ciOutput = formatPolicyPlanForCi(plan);
    expect(ciOutput).toContain("status=ok");
    expect(ciOutput).toContain("change=add:rule-2");
  });
});
