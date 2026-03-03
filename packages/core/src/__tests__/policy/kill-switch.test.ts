import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { EmergencyKillSwitch, KillSwitchBlockedError } from "../../policy/kill-switch.js";

describe("EmergencyKillSwitch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions to active within the 30-second activation SLA", async () => {
    const killSwitch = new EmergencyKillSwitch();

    await killSwitch.activate({ actor: "oncall-engineer", reason: "incident response" });

    expect(killSwitch.getState().status).toBe("activating");

    vi.advanceTimersByTime(29_000);
    expect(killSwitch.getState().status).toBe("activating");

    vi.advanceTimersByTime(1_000);
    const state = killSwitch.getState();
    expect(state.status).toBe("active");

    const requestedAt = new Date(state.activationRequestedAt ?? "").getTime();
    const activeAt = new Date(state.activeAt ?? "").getTime();
    expect(activeAt - requestedAt).toBeLessThanOrEqual(30_000);
  });

  it("blocks protected actions while activating/active and records enforcement audit entries", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const killSwitch = new EmergencyKillSwitch({
      protectedActions: ["tool.execute", "admin.*"],
      auditStorage,
    });

    await killSwitch.activate({ actor: "security-bot", reason: "suspicious activity" });

    await expect(
      killSwitch.enforce({
        actor: "user-1",
        action: "tool.execute",
        targetId: "job-42",
        tool: "executor",
      }),
    ).rejects.toBeInstanceOf(KillSwitchBlockedError);

    vi.advanceTimersByTime(30_000);

    await expect(
      killSwitch.enforce({
        actor: "user-1",
        action: "admin.delete",
        targetId: "user-2",
      }),
    ).rejects.toBeInstanceOf(KillSwitchBlockedError);

    const securityEvents = await auditStorage.query({ category: "security" }, 20, 0);
    const actions = securityEvents.entries.map((entry) => entry.action);

    expect(actions).toContain("kill-switch.activate");
    expect(actions).toContain("kill-switch.enforce.block");
  });

  it("allows recovery after deactivation and records lifecycle audits", async () => {
    const auditStorage = new InMemoryAuditStorage();
    await auditStorage.init();

    const killSwitch = new EmergencyKillSwitch({
      protectedActions: ["db.write"],
      auditStorage,
    });

    await killSwitch.activate({ actor: "oncall-engineer" });

    await expect(
      killSwitch.enforce({
        actor: "service-account",
        action: "db.write",
      }),
    ).rejects.toBeInstanceOf(KillSwitchBlockedError);

    await killSwitch.deactivate({ actor: "oncall-engineer", reason: "incident resolved" });

    await expect(
      killSwitch.enforce({
        actor: "service-account",
        action: "db.write",
      }),
    ).resolves.toBeUndefined();

    const securityEvents = await auditStorage.query({ category: "security" }, 20, 0);
    const actions = securityEvents.entries.map((entry) => entry.action);

    expect(actions).toContain("kill-switch.activate");
    expect(actions).toContain("kill-switch.deactivate");
  });

  it("fails closed when protected-action matching throws", async () => {
    const killSwitch = new EmergencyKillSwitch({
      // Force an internal matcher exception by passing a non-string pattern.
      protectedActions: [null as unknown as string],
    });

    await killSwitch.activate({ actor: "security-bot" });

    await expect(
      killSwitch.enforce({
        actor: "user-1",
        action: "safe.read",
      }),
    ).rejects.toBeInstanceOf(KillSwitchBlockedError);
  });
});
