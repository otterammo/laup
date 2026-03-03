import { describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import {
  createRateLimitContext,
  enforceRateLimit,
  RateLimitExceededError,
  RateLimiter,
} from "../../policy/rate-limiter.js";

describe("RateLimiter", () => {
  it("enforces per-actor limits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));

    const limiter = new RateLimiter({
      now: () => new Date(),
      rules: [{ id: "actor-minute", dimensions: ["actor"], limit: 2, windowMs: 60_000 }],
    });

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute" }),
    ).resolves.toBeDefined();
    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute" }),
    ).resolves.toBeDefined();

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute" }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    // Different actor is isolated.
    await expect(
      enforceRateLimit(limiter, { actor: "user-2", action: "tool.execute" }),
    ).resolves.toBeDefined();

    vi.useRealTimers();
  });

  it("enforces per-tool limits", async () => {
    const limiter = new RateLimiter({
      rules: [{ id: "tool-hour", dimensions: ["tool"], limit: 1, windowMs: 3_600_000 }],
    });

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute", tool: "shell" }),
    ).resolves.toBeDefined();

    await expect(
      enforceRateLimit(limiter, { actor: "user-2", action: "tool.execute", tool: "shell" }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute", tool: "browser" }),
    ).resolves.toBeDefined();
  });

  it("enforces per-project limits", async () => {
    const limiter = new RateLimiter({
      rules: [{ id: "project-minute", dimensions: ["project"], limit: 2, windowMs: 60_000 }],
    });

    await expect(
      enforceRateLimit(limiter, {
        actor: "user-1",
        action: "deploy",
        project: "proj-1",
      }),
    ).resolves.toBeDefined();

    await expect(
      enforceRateLimit(limiter, {
        actor: "user-2",
        action: "deploy",
        project: "proj-1",
      }),
    ).resolves.toBeDefined();

    await expect(
      enforceRateLimit(limiter, {
        actor: "user-3",
        action: "deploy",
        project: "proj-1",
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    await expect(
      enforceRateLimit(limiter, {
        actor: "user-3",
        action: "deploy",
        project: "proj-2",
      }),
    ).resolves.toBeDefined();
  });

  it("resets counters when window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));

    const limiter = new RateLimiter({
      now: () => new Date(),
      rules: [{ id: "actor-short", dimensions: ["actor"], limit: 1, windowMs: 10_000 }],
    });

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "read" }),
    ).resolves.toBeDefined();
    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "read" }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    vi.advanceTimersByTime(10_000);

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "read" }),
    ).resolves.toBeDefined();

    vi.useRealTimers();
  });

  it("applies combined constraints deterministically", async () => {
    const limiter = new RateLimiter({
      rules: [
        { id: "actor-limit", dimensions: ["actor"], limit: 10, windowMs: 60_000 },
        { id: "actor-tool-limit", dimensions: ["actor", "tool"], limit: 2, windowMs: 60_000 },
      ],
    });

    await enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute", tool: "shell" });
    await enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute", tool: "shell" });

    await expect(
      enforceRateLimit(limiter, { actor: "user-1", action: "tool.execute", tool: "shell" }),
    ).rejects.toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      decision: {
        reason: "limit_exceeded",
        exceededBy: {
          ruleId: "actor-tool-limit",
        },
      },
    });
  });

  it("records audit events for allow/deny enforcement decisions", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const limiter = new RateLimiter({
      auditStorage,
      rules: [{ id: "actor-limit", dimensions: ["actor"], limit: 1, windowMs: 60_000 }],
    });

    await enforceRateLimit(limiter, {
      actor: "user-1",
      action: "tool.execute",
      tool: "shell",
      project: "proj-1",
      correlationId: "corr-1",
    });

    await expect(
      enforceRateLimit(limiter, {
        actor: "user-1",
        action: "tool.execute",
        tool: "shell",
        project: "proj-1",
        correlationId: "corr-1",
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    const securityEvents = await auditStorage.query({ category: "security" }, 20, 0);
    expect(securityEvents.entries.map((entry) => entry.action).sort()).toEqual([
      "rate-limit.enforce.allow",
      "rate-limit.enforce.deny",
    ]);
  });

  it("creates rate-limit context from policy/auth identifiers", () => {
    const context = createRateLimitContext({
      auth: {
        method: "api-key",
        identity: { id: "auth-user", type: "user", roles: [], scopes: [] },
      },
      evaluation: {
        actor: { id: "eval-user", type: "user" },
        action: "tool.execute",
        resource: { type: "tool", id: "shell" },
        scopeChain: [
          { scope: "user", id: "u-1" },
          { scope: "project", id: "proj-9" },
        ],
      },
      tool: "shell",
      correlationId: "corr-22",
    });

    expect(context).toEqual({
      actor: "auth-user",
      action: "tool.execute",
      tool: "shell",
      project: "proj-9",
      correlationId: "corr-22",
    });
  });
});
