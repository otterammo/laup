import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySkillRegistry,
  type InstalledSkill,
  type SkillRegistry,
} from "../skill-registry.js";
import type { SemanticVersion } from "../skill-version.js";

describe("skill-registry", () => {
  let registry: SkillRegistry;

  const makeVersion = (major = 1, minor = 0, patch = 0): SemanticVersion => ({
    major,
    minor,
    patch,
  });

  const makeSkill = (
    overrides: Partial<Omit<InstalledSkill, "installedAt">> = {},
  ): Omit<InstalledSkill, "installedAt"> => ({
    id: "test-org/test-skill",
    version: makeVersion(),
    status: "installed",
    source: "https://example.com/skill.tar.gz",
    installedBy: "admin",
    scope: "global",
    scopeType: "global",
    ...overrides,
  });

  beforeEach(async () => {
    registry = new InMemorySkillRegistry();
    await registry.init();
  });

  describe("install", () => {
    it("installs a skill", async () => {
      await registry.install(makeSkill());
      const skill = await registry.get("test-org/test-skill");
      expect(skill).not.toBeNull();
      expect(skill?.id).toBe("test-org/test-skill");
    });

    it("sets installedAt automatically", async () => {
      await registry.install(makeSkill());
      const skill = await registry.get("test-org/test-skill");
      expect(skill?.installedAt).toBeDefined();
    });

    it("stores version components", async () => {
      await registry.install(makeSkill({ version: makeVersion(2, 3, 4) }));
      const skill = await registry.get("test-org/test-skill");
      expect(skill?.version).toEqual({ major: 2, minor: 3, patch: 4 });
    });
  });

  describe("get", () => {
    it("returns null for unknown skill", async () => {
      const skill = await registry.get("unknown");
      expect(skill).toBeNull();
    });

    it("gets skill by scope", async () => {
      await registry.install(makeSkill({ scope: "project-1", scopeType: "project" }));
      await registry.install(makeSkill({ scope: "project-2", scopeType: "project" }));

      const skill1 = await registry.get("test-org/test-skill", "project-1");
      const skill2 = await registry.get("test-org/test-skill", "project-2");

      expect(skill1?.scope).toBe("project-1");
      expect(skill2?.scope).toBe("project-2");
    });
  });

  describe("list", () => {
    it("lists all installed skills", async () => {
      await registry.install(makeSkill({ id: "org/skill-1" }));
      await registry.install(makeSkill({ id: "org/skill-2" }));

      const skills = await registry.list();
      expect(skills).toHaveLength(2);
    });

    it("filters by scope", async () => {
      await registry.install(makeSkill({ scope: "proj-1", scopeType: "project" }));
      await registry.install(makeSkill({ scope: "proj-2", scopeType: "project" }));

      const skills = await registry.list({ scope: "proj-1" });
      expect(skills).toHaveLength(1);
    });

    it("filters by status", async () => {
      await registry.install(makeSkill({ id: "org/active", status: "installed" }));
      await registry.install(makeSkill({ id: "org/pending", status: "pending" }));

      const skills = await registry.list({ status: "installed" });
      expect(skills).toHaveLength(1);
      expect(skills[0]?.id).toBe("org/active");
    });

    it("excludes disabled by default", async () => {
      await registry.install(makeSkill({ id: "org/active", status: "installed" }));
      await registry.install(makeSkill({ id: "org/disabled", status: "disabled" }));

      const skills = await registry.list();
      expect(skills).toHaveLength(1);
    });

    it("includes disabled when requested", async () => {
      await registry.install(makeSkill({ status: "disabled" }));

      const skills = await registry.list({ includeDisabled: true });
      expect(skills).toHaveLength(1);
    });

    it("filters by name pattern", async () => {
      await registry.install(makeSkill({ id: "org/weather-skill" }));
      await registry.install(makeSkill({ id: "org/calendar-skill" }));

      const skills = await registry.list({ namePattern: "weather" });
      expect(skills).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("updates skill version", async () => {
      await registry.install(makeSkill({ version: makeVersion(1, 0, 0) }));

      await registry.update("test-org/test-skill", makeVersion(2, 0, 0));

      const skill = await registry.get("test-org/test-skill");
      expect(skill?.version.major).toBe(2);
    });

    it("sets updatedAt", async () => {
      await registry.install(makeSkill());
      const before = await registry.get("test-org/test-skill");
      expect(before?.updatedAt).toBeUndefined();

      await registry.update("test-org/test-skill", makeVersion(2, 0, 0));

      const after = await registry.get("test-org/test-skill");
      expect(after?.updatedAt).toBeDefined();
    });

    it("throws for unknown skill", async () => {
      await expect(registry.update("unknown", makeVersion())).rejects.toThrow("not found");
    });
  });

  describe("uninstall", () => {
    it("removes skill", async () => {
      await registry.install(makeSkill());
      await registry.uninstall("test-org/test-skill");

      const skill = await registry.get("test-org/test-skill");
      expect(skill).toBeNull();
    });
  });

  describe("enable/disable", () => {
    it("disables a skill", async () => {
      await registry.install(makeSkill());
      await registry.disable("test-org/test-skill");

      const skill = await registry.get("test-org/test-skill");
      expect(skill?.status).toBe("disabled");
    });

    it("enables a disabled skill", async () => {
      await registry.install(makeSkill({ status: "disabled" }));
      await registry.enable("test-org/test-skill");

      const skill = await registry.get("test-org/test-skill");
      expect(skill?.status).toBe("installed");
    });
  });

  describe("setStatus", () => {
    it("sets status with error", async () => {
      await registry.install(makeSkill());
      await registry.setStatus("test-org/test-skill", "failed", "Installation failed");

      const skill = await registry.get("test-org/test-skill");
      expect(skill?.status).toBe("failed");
      expect(skill?.error).toBe("Installation failed");
    });

    it("clears error when status changes", async () => {
      await registry.install(makeSkill());
      await registry.setStatus("test-org/test-skill", "failed", "Error");
      await registry.setStatus("test-org/test-skill", "installed");

      const skill = await registry.get("test-org/test-skill");
      expect(skill?.error).toBeUndefined();
    });
  });

  describe("config", () => {
    it("gets and sets config", async () => {
      await registry.install(makeSkill());

      await registry.setConfig("test-org/test-skill", { key: "value" });

      const config = await registry.getConfig("test-org/test-skill");
      expect(config).toEqual({ key: "value" });
    });

    it("returns null for skill without config", async () => {
      await registry.install(makeSkill());
      const config = await registry.getConfig("test-org/test-skill");
      expect(config).toBeNull();
    });
  });

  describe("findSatisfying", () => {
    it("finds skills matching version constraint", async () => {
      await registry.install(makeSkill({ id: "org/skill", version: makeVersion(1, 5, 0) }));
      await registry.install(
        makeSkill({
          id: "org/skill",
          version: makeVersion(2, 0, 0),
          scope: "proj-1",
          scopeType: "project",
        }),
      );

      const skills = await registry.findSatisfying("org/skill", {
        type: "range",
        min: "1.0.0",
        minInclusive: true,
      });
      expect(skills).toHaveLength(2);
    });

    it("excludes skills not matching constraint", async () => {
      await registry.install(makeSkill({ version: makeVersion(1, 0, 0) }));

      const skills = await registry.findSatisfying("test-org/test-skill", {
        type: "range",
        min: "2.0.0",
        minInclusive: true,
      });
      expect(skills).toHaveLength(0);
    });
  });

  describe("getDependents", () => {
    it("finds skills that depend on given skill", async () => {
      await registry.install(makeSkill({ id: "org/base" }));
      await registry.install(
        makeSkill({
          id: "org/dependent",
          dependencies: ["org/base"],
        }),
      );

      const dependents = await registry.getDependents("org/base");
      expect(dependents).toHaveLength(1);
      expect(dependents[0]?.id).toBe("org/dependent");
    });
  });

  describe("checkUpdates", () => {
    it("detects available updates", async () => {
      await registry.install(makeSkill({ version: makeVersion(1, 0, 0) }));

      const availableVersions = new Map([
        ["test-org/test-skill", [makeVersion(1, 0, 0), makeVersion(1, 5, 0), makeVersion(2, 0, 0)]],
      ]);

      const updates = await (registry as InMemorySkillRegistry).checkUpdates(availableVersions);
      expect(updates).toHaveLength(1);
      expect(updates[0]?.latestVersion.major).toBe(2);
    });

    it("detects breaking changes", async () => {
      await registry.install(makeSkill({ version: makeVersion(1, 0, 0) }));

      const availableVersions = new Map([["test-org/test-skill", [makeVersion(2, 0, 0)]]]);

      const updates = await (registry as InMemorySkillRegistry).checkUpdates(availableVersions);
      expect(updates[0]?.breakingChanges).toBe(true);
    });

    it("returns empty for up-to-date skills", async () => {
      await registry.install(makeSkill({ version: makeVersion(2, 0, 0) }));

      const availableVersions = new Map([
        ["test-org/test-skill", [makeVersion(1, 0, 0), makeVersion(2, 0, 0)]],
      ]);

      const updates = await (registry as InMemorySkillRegistry).checkUpdates(availableVersions);
      expect(updates).toHaveLength(0);
    });
  });
});
