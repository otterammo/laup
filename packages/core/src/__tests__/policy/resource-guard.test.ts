import { describe, expect, it } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import {
  enforceResourceAccess,
  ResourceAccessBlockedError,
  ResourceGuard,
} from "../../policy/resource-guard.js";

describe("ResourceGuard", () => {
  it("supports URL exact + prefix + glob patterns", async () => {
    const guard = new ResourceGuard({
      rules: [
        {
          id: "url-allow-exact",
          effect: "allow",
          targetType: "url",
          patternType: "exact",
          pattern: "https://api.example.com/v1/health",
        },
        {
          id: "url-allow-prefix",
          effect: "allow",
          targetType: "url",
          patternType: "prefix",
          pattern: "https://api.example.com/v1/",
        },
        {
          id: "url-deny-glob",
          effect: "deny",
          targetType: "url",
          patternType: "glob",
          pattern: "https://api.example.com/v1/private/**",
        },
      ],
    });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "url",
        target: "https://api.example.com/v1/health",
      }),
    ).resolves.toMatchObject({ allowed: true });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "url",
        target: "https://api.example.com/v1/public/users",
      }),
    ).resolves.toMatchObject({ allowed: true });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "url",
        target: "https://api.example.com/v1/private/secrets",
      }),
    ).rejects.toBeInstanceOf(ResourceAccessBlockedError);
  });

  it("supports API allowlist with deny precedence", async () => {
    const guard = new ResourceGuard({
      rules: [
        {
          id: "api-allow-all-users",
          effect: "allow",
          targetType: "api",
          patternType: "glob",
          pattern: "users.*",
        },
        {
          id: "api-deny-users.delete",
          effect: "deny",
          targetType: "api",
          patternType: "exact",
          pattern: "users.delete",
        },
      ],
    });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "api",
        target: "users.get",
      }),
    ).resolves.toMatchObject({ allowed: true });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "api",
        target: "users.delete",
      }),
    ).rejects.toMatchObject({
      code: "RESOURCE_ACCESS_BLOCKED",
      decision: {
        reason: "explicit_deny",
        matchedRule: {
          ruleId: "api-deny-users.delete",
          effect: "deny",
        },
      },
    });
  });

  it("supports file path matching and returns no_allow_rule for unmatched allowlist", async () => {
    const guard = new ResourceGuard({
      rules: [
        {
          id: "file-allow-prefix",
          effect: "allow",
          targetType: "file",
          patternType: "prefix",
          pattern: "/workspace/project/",
        },
        {
          id: "file-deny-secrets",
          effect: "deny",
          targetType: "file",
          patternType: "glob",
          pattern: "/workspace/project/**/.env*",
        },
      ],
    });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "file",
        target: "/workspace/project/src/index.ts",
      }),
    ).resolves.toMatchObject({ allowed: true });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "file",
        target: "/workspace/project/app/.env.local",
      }),
    ).rejects.toBeInstanceOf(ResourceAccessBlockedError);

    const decision = await guard.evaluate({
      actor: "user-1",
      targetType: "file",
      target: "/workspace/other/readme.md",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "no_allow_rule",
    });
    expect(decision.matchedRule).toBeUndefined();
  });

  it("is deterministic when overlapping deny rules match", async () => {
    const guard = new ResourceGuard({
      rules: [
        {
          id: "z-deny",
          effect: "deny",
          targetType: "url",
          patternType: "prefix",
          pattern: "https://evil.example/",
        },
        {
          id: "a-deny",
          effect: "deny",
          targetType: "url",
          patternType: "glob",
          pattern: "https://evil.example/**",
        },
      ],
    });

    const decision = await guard.evaluate({
      actor: "user-1",
      targetType: "url",
      target: "https://evil.example/path",
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "explicit_deny",
      matchedRule: {
        ruleId: "a-deny",
      },
    });
  });

  it("defaults to allow when no allow rules exist for target type", async () => {
    const guard = new ResourceGuard({
      rules: [
        {
          id: "url-deny-private",
          effect: "deny",
          targetType: "url",
          patternType: "prefix",
          pattern: "https://private.example/",
        },
      ],
    });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "url",
        target: "https://public.example/",
      }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it("records audit events with matched rule metadata", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const guard = new ResourceGuard({
      auditStorage,
      rules: [
        {
          id: "api-allow",
          effect: "allow",
          targetType: "api",
          patternType: "glob",
          pattern: "repo.*",
        },
        {
          id: "api-deny",
          effect: "deny",
          targetType: "api",
          patternType: "exact",
          pattern: "repo.delete",
        },
      ],
    });

    await enforceResourceAccess(guard, {
      actor: "user-1",
      targetType: "api",
      target: "repo.get",
      correlationId: "corr-1",
    });

    await expect(
      enforceResourceAccess(guard, {
        actor: "user-1",
        targetType: "api",
        target: "repo.delete",
        correlationId: "corr-1",
      }),
    ).rejects.toBeInstanceOf(ResourceAccessBlockedError);

    const events = await auditStorage.query({ category: "security" }, 20, 0);
    expect(events.entries.map((entry) => entry.action).sort()).toEqual([
      "resource-guard.enforce.allow",
      "resource-guard.enforce.deny",
    ]);

    const denyEvent = events.entries.find(
      (entry) => entry.action === "resource-guard.enforce.deny",
    );
    expect(denyEvent?.metadata).toMatchObject({
      decision: "explicit_deny",
      matchedRule: {
        ruleId: "api-deny",
        effect: "deny",
      },
    });
  });
});
