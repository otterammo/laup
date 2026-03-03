import type { AuditStorage } from "../audit-storage.js";
import type { EvaluationContext } from "./evaluation-context.js";

export type ActionHookPhase = "pre" | "post";

export interface ActionHookContext {
  evaluation: EvaluationContext;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface HookVetoResult {
  allow: false;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface HookAllowResult {
  allow: true;
  metadata?: Record<string, unknown>;
}

export type PreActionHookResult = HookAllowResult | HookVetoResult | void;

export interface ActionHookDefinition {
  id: string;
  order?: number;
}

export interface PreActionHook extends ActionHookDefinition {
  run(context: ActionHookContext): Promise<PreActionHookResult> | PreActionHookResult;
}

export interface PostActionHookContext extends ActionHookContext {
  outcome: "success" | "failure";
  result?: unknown;
  error?: unknown;
}

export interface PostActionHook extends ActionHookDefinition {
  run(context: PostActionHookContext): Promise<void> | void;
}

export interface ExecuteActionWithHooksOptions<T> {
  context: ActionHookContext;
  preHooks?: PreActionHook[];
  postHooks?: PostActionHook[];
  execute: () => Promise<T> | T;
  auditStorage?: AuditStorage;
}

export class PreActionVetoError extends Error {
  readonly code = "PRE_ACTION_VETO";

  constructor(
    public readonly hookId: string,
    public readonly reason: string,
  ) {
    super(`Pre-action hook vetoed execution (${hookId}): ${reason}`);
    this.name = "PreActionVetoError";
  }
}

export class ActionHookExecutionError extends Error {
  readonly code = "ACTION_HOOK_FAILURE";

  constructor(
    public readonly phase: ActionHookPhase,
    public readonly hookId: string,
    cause: unknown,
  ) {
    super(`Action ${phase}-hook failed (${hookId})`);
    this.name = "ActionHookExecutionError";
    this.cause = cause;
  }
}

export async function executeActionWithHooks<T>(
  options: ExecuteActionWithHooksOptions<T>,
): Promise<T> {
  const preHooks = sortHooks(options.preHooks ?? []);
  const postHooks = sortHooks(options.postHooks ?? []);

  for (const hook of preHooks) {
    await auditHook("pre", "hook.pre.evaluate", hook.id, options);

    try {
      const decision = await hook.run(options.context);
      if (decision && decision.allow === false) {
        await auditHook("pre", "hook.pre.veto", hook.id, options, {
          reason: decision.reason,
          ...(decision.metadata ? { metadata: decision.metadata } : {}),
        });
        throw new PreActionVetoError(hook.id, decision.reason);
      }
    } catch (error) {
      if (error instanceof PreActionVetoError) {
        throw error;
      }

      await auditHook("pre", "hook.pre.failure", hook.id, options, {
        error: toErrorMetadata(error),
      });
      throw new ActionHookExecutionError("pre", hook.id, error);
    }
  }

  let result: T;
  try {
    result = await options.execute();
  } catch (error) {
    await runPostHooks(postHooks, {
      ...options,
      postContext: {
        ...options.context,
        outcome: "failure",
        error,
      },
    });
    throw error;
  }

  await runPostHooks(postHooks, {
    ...options,
    postContext: {
      ...options.context,
      outcome: "success",
      result,
    },
  });

  return result;
}

async function runPostHooks(
  hooks: PostActionHook[],
  input: {
    context: ActionHookContext;
    postContext: PostActionHookContext;
    auditStorage?: AuditStorage;
  },
): Promise<void> {
  for (const hook of hooks) {
    await auditHook("post", "hook.post.evaluate", hook.id, {
      context: input.context,
      ...(input.auditStorage ? { auditStorage: input.auditStorage } : {}),
    });

    try {
      await hook.run(input.postContext);
    } catch (error) {
      await auditHook(
        "post",
        "hook.post.failure",
        hook.id,
        {
          context: input.context,
          ...(input.auditStorage ? { auditStorage: input.auditStorage } : {}),
        },
        {
          error: toErrorMetadata(error),
        },
      );

      throw new ActionHookExecutionError("post", hook.id, error);
    }
  }
}

function sortHooks<T extends ActionHookDefinition>(hooks: T[]): T[] {
  return [...hooks].sort((a, b) => {
    const orderDelta = (a.order ?? 0) - (b.order ?? 0);
    if (orderDelta !== 0) {
      return orderDelta;
    }

    return a.id.localeCompare(b.id);
  });
}

async function auditHook(
  phase: ActionHookPhase,
  action: string,
  hookId: string,
  input: {
    context: ActionHookContext;
    auditStorage?: AuditStorage;
  },
  details?: {
    reason?: string;
    metadata?: Record<string, unknown>;
    error?: Record<string, unknown>;
  },
): Promise<void> {
  if (!input.auditStorage) {
    return;
  }

  await input.auditStorage.append({
    category: "access",
    action,
    actor: input.context.evaluation.actor.id,
    targetId: input.context.evaluation.resource.id ?? input.context.evaluation.resource.type,
    targetType: "hook",
    severity: action.includes("failure") || action.includes("veto") ? "warning" : "info",
    ...(details?.reason ? { reason: details.reason } : {}),
    ...(input.context.correlationId ? { correlationId: input.context.correlationId } : {}),
    metadata: {
      hookId,
      hookPhase: phase,
      permissionAction: input.context.evaluation.action,
      resourceType: input.context.evaluation.resource.type,
      ...(details?.metadata ? { hookMetadata: details.metadata } : {}),
      ...(details?.error ? { error: details.error } : {}),
    },
  });
}

function toErrorMetadata(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: String(error),
  };
}
