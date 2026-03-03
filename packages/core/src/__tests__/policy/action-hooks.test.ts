import { describe, expect, it } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import {
  type ActionHookExecutionError,
  executeActionWithHooks,
  PreActionVetoError,
} from "../../policy/action-hooks.js";
import { createEvaluationContext } from "../../policy/evaluation-context.js";

const evaluation = createEvaluationContext(
  { id: "user-1", type: "user" },
  "execute",
  { type: "tool-call", id: "shell" },
  [{ scope: "org", id: "org-1" }],
);

const context = {
  evaluation,
  correlationId: "corr-hooks-1",
};

describe("executeActionWithHooks", () => {
  it("runs allow path in deterministic order and returns action result", async () => {
    const calls: string[] = [];

    const result = await executeActionWithHooks({
      context,
      preHooks: [
        {
          id: "z-last",
          run: () => {
            calls.push("pre:z-last");
          },
        },
        {
          id: "a-first",
          run: () => {
            calls.push("pre:a-first");
          },
        },
      ],
      postHooks: [
        {
          id: "post-b",
          order: 5,
          run: () => {
            calls.push("post:post-b");
          },
        },
        {
          id: "post-a",
          order: 1,
          run: () => {
            calls.push("post:post-a");
          },
        },
      ],
      execute: () => {
        calls.push("action");
        return "ok";
      },
    });

    expect(result).toBe("ok");
    expect(calls).toEqual(["pre:a-first", "pre:z-last", "action", "post:post-a", "post:post-b"]);
  });

  it("blocks execution when a pre-hook vetoes", async () => {
    let actionCalled = false;

    await expect(
      executeActionWithHooks({
        context,
        preHooks: [
          { id: "risk-gate", run: () => ({ allow: false, reason: "manual approval required" }) },
        ],
        execute: () => {
          actionCalled = true;
          return "nope";
        },
      }),
    ).rejects.toMatchObject({
      name: "PreActionVetoError",
      hookId: "risk-gate",
      reason: "manual approval required",
    } satisfies Partial<PreActionVetoError>);

    expect(actionCalled).toBe(false);
  });

  it("wraps hook failures with phase-aware error", async () => {
    await expect(
      executeActionWithHooks({
        context,
        preHooks: [
          {
            id: "pre-crash",
            run: () => {
              throw new Error("boom");
            },
          },
        ],
        execute: () => "never",
      }),
    ).rejects.toMatchObject({
      name: "ActionHookExecutionError",
      phase: "pre",
      hookId: "pre-crash",
    } satisfies Partial<ActionHookExecutionError>);
  });

  it("runs post-hooks on action failure and passes failure outcome", async () => {
    const outcomes: string[] = [];

    await expect(
      executeActionWithHooks({
        context,
        postHooks: [
          {
            id: "post-observe",
            run: (hookContext) => {
              outcomes.push(hookContext.outcome);
              outcomes.push(String((hookContext.error as Error | undefined)?.message));
            },
          },
        ],
        execute: () => {
          throw new Error("action-failed");
        },
      }),
    ).rejects.toThrow("action-failed");

    expect(outcomes).toEqual(["failure", "action-failed"]);
  });

  it("emits audit events for evaluation, veto, and failures", async () => {
    const audit = new InMemoryAuditStorage();
    await audit.init();

    await expect(
      executeActionWithHooks({
        context,
        auditStorage: audit,
        preHooks: [
          { id: "pre-ok", run: () => ({ allow: true }) },
          { id: "pre-veto", run: () => ({ allow: false, reason: "blocked" }) },
        ],
        execute: () => "never",
      }),
    ).rejects.toBeInstanceOf(PreActionVetoError);

    await expect(
      executeActionWithHooks({
        context,
        auditStorage: audit,
        postHooks: [
          {
            id: "post-fail",
            run: () => {
              throw new Error("post-boom");
            },
          },
        ],
        execute: () => "ok",
      }),
    ).rejects.toMatchObject({ phase: "post", hookId: "post-fail" });

    const page = await audit.query({ category: "access" }, 50, 0);
    const actions = page.entries.map((entry) => entry.action);

    expect(actions).toContain("hook.pre.evaluate");
    expect(actions).toContain("hook.pre.veto");
    expect(actions).toContain("hook.post.evaluate");
    expect(actions).toContain("hook.post.failure");
  });
});
