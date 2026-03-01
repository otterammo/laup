import { describe, expect, it } from "vitest";
import {
  type AccessContext,
  canAccessSkill,
  canForkSkill,
  canInstallSkill,
  detectCircularDependency,
  getComposedSkillDependencies,
  getDeprecationNotice,
  getRunnableTests,
  getSkillVisibility,
  hasTests,
  isComposedSkill,
  isNamespacedSkill,
  isSkillDeprecated,
  parseSkill,
  parseSkillName,
  qualifySkillName,
  renderSkillPrompt,
  resolveStepParams,
  runAssertion,
  type Skill,
  type SkillStep,
  type SkillTestAssertion,
  skillBelongsToNamespace,
  skillNamesEqual,
  validateSkill,
  validateSkillNamespace,
} from "../skill-schema.js";

describe("skill-schema", () => {
  const validSkill: Skill = {
    schemaVersion: "1.0",
    name: "code-review",
    version: "1.0.0",
    description: "Review code for best practices and issues",
    parameters: [
      {
        name: "language",
        description: "Programming language",
        type: "string",
        required: true,
      },
      {
        name: "focus",
        description: "Review focus area",
        type: "selection",
        required: false,
        options: ["security", "performance", "maintainability"],
        default: "maintainability",
      },
    ],
    trigger: {
      command: "/review",
      aliases: ["code review", "review code"],
    },
    prompt: "Review this {{language}} code with focus on {{focus}}:\n\n{{code}}",
    metadata: {
      author: "laup",
      tags: ["code", "review"],
    },
  };

  describe("validateSkill", () => {
    it("validates a correct skill", () => {
      const result = validateSkill(validSkill);
      expect(result.valid).toBe(true);
      expect(result.skill).toBeDefined();
      expect(result.issues).toHaveLength(0);
    });

    it("rejects skill without name", () => {
      const { name, ...skillWithoutName } = validSkill;
      const result = validateSkill(skillWithoutName);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "name")).toBe(true);
    });

    it("rejects skill without version", () => {
      const { version, ...skillWithoutVersion } = validSkill;
      const result = validateSkill(skillWithoutVersion);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "version")).toBe(true);
    });

    it("rejects invalid version format", () => {
      const result = validateSkill({ ...validSkill, version: "1.0" });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("semver"))).toBe(true);
    });

    it("rejects invalid trigger command", () => {
      const result = validateSkill({
        ...validSkill,
        trigger: { command: "review" }, // missing /
      });
      expect(result.valid).toBe(false);
    });

    it("accepts namespaced skill names", () => {
      const result = validateSkill({
        ...validSkill,
        name: "myorg/code-review",
      });
      expect(result.valid).toBe(true);
    });

    it("accepts prerelease versions", () => {
      const result = validateSkill({
        ...validSkill,
        version: "1.0.0-beta.1",
      });
      expect(result.valid).toBe(true);
    });

    it("validates parameter types", () => {
      const result = validateSkill({
        ...validSkill,
        parameters: [
          { name: "count", type: "number", required: true },
          { name: "enabled", type: "boolean", required: false },
          { name: "items", type: "array", items: "string", required: false },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("parseSkill", () => {
    it("parses valid JSON skill", () => {
      const json = JSON.stringify(validSkill);
      const skill = parseSkill(json);
      expect(skill.name).toBe("code-review");
    });

    it("parses valid YAML skill", () => {
      const yaml = `
schemaVersion: "1.0"
name: test-skill
version: 1.0.0
description: A test skill
trigger:
  command: /test
prompt: Hello {{name}}
`;
      const skill = parseSkill(yaml);
      expect(skill.name).toBe("test-skill");
    });

    it("throws on invalid skill", () => {
      expect(() => parseSkill('{"name": "invalid"}')).toThrow("Invalid skill");
    });
  });

  describe("renderSkillPrompt", () => {
    it("substitutes parameters", () => {
      const skill: Skill = {
        schemaVersion: "1.0",
        name: "greet",
        version: "1.0.0",
        description: "Greeting skill",
        parameters: [{ name: "name", type: "string", required: true }],
        trigger: { command: "/greet" },
        prompt: "Hello, {{name}}!",
      };

      const result = renderSkillPrompt(skill, { name: "World" });
      expect(result).toBe("Hello, World!");
    });

    it("uses default values", () => {
      const skill: Skill = {
        schemaVersion: "1.0",
        name: "greet",
        version: "1.0.0",
        description: "Greeting skill",
        parameters: [{ name: "name", type: "string", required: false, default: "friend" }],
        trigger: { command: "/greet" },
        prompt: "Hello, {{name}}!",
      };

      const result = renderSkillPrompt(skill, {});
      expect(result).toBe("Hello, friend!");
    });

    it("throws on missing required parameter", () => {
      const skill: Skill = {
        schemaVersion: "1.0",
        name: "greet",
        version: "1.0.0",
        description: "Greeting skill",
        parameters: [{ name: "name", type: "string", required: true }],
        trigger: { command: "/greet" },
        prompt: "Hello, {{name}}!",
      };

      expect(() => renderSkillPrompt(skill, {})).toThrow("Missing required parameter");
    });

    it("handles multiple parameters", () => {
      const skill: Skill = {
        schemaVersion: "1.0",
        name: "template",
        version: "1.0.0",
        description: "Template skill",
        parameters: [
          { name: "a", type: "string", required: true },
          { name: "b", type: "string", required: true },
        ],
        trigger: { command: "/template" },
        prompt: "{{a}} and {{b}} together: {{a}}{{b}}",
      };

      const result = renderSkillPrompt(skill, { a: "X", b: "Y" });
      expect(result).toBe("X and Y together: XY");
    });
  });

  describe("deprecation (SKILL-012)", () => {
    it("isSkillDeprecated returns false for non-deprecated skill", () => {
      expect(isSkillDeprecated(validSkill)).toBe(false);
    });

    it("isSkillDeprecated returns true for deprecated skill", () => {
      const deprecatedSkill: Skill = {
        ...validSkill,
        deprecation: { deprecated: true },
      };
      expect(isSkillDeprecated(deprecatedSkill)).toBe(true);
    });

    it("getDeprecationNotice returns null for non-deprecated skill", () => {
      expect(getDeprecationNotice(validSkill)).toBeNull();
    });

    it("getDeprecationNotice returns basic notice", () => {
      const deprecatedSkill: Skill = {
        ...validSkill,
        deprecation: { deprecated: true },
      };
      const notice = getDeprecationNotice(deprecatedSkill);
      expect(notice).toContain("DEPRECATED");
      expect(notice).toContain("code-review");
    });

    it("getDeprecationNotice includes message", () => {
      const deprecatedSkill: Skill = {
        ...validSkill,
        deprecation: {
          deprecated: true,
          message: "This skill has been superseded.",
        },
      };
      const notice = getDeprecationNotice(deprecatedSkill);
      expect(notice).toContain("This skill has been superseded");
    });

    it("getDeprecationNotice includes replacement", () => {
      const deprecatedSkill: Skill = {
        ...validSkill,
        deprecation: {
          deprecated: true,
          replacement: "better/code-review",
        },
      };
      const notice = getDeprecationNotice(deprecatedSkill);
      expect(notice).toContain("better/code-review");
      expect(notice).toContain("instead");
    });

    it("getDeprecationNotice includes removeBy date", () => {
      const deprecatedSkill: Skill = {
        ...validSkill,
        deprecation: {
          deprecated: true,
          removeBy: "2026-12-31",
        },
      };
      const notice = getDeprecationNotice(deprecatedSkill);
      expect(notice).toContain("2026-12-31");
      expect(notice).toContain("removed");
    });

    it("validates deprecation schema", () => {
      const result = validateSkill({
        ...validSkill,
        deprecation: {
          deprecated: true,
          message: "Use v2",
          replacement: "code-review-v2",
          since: "2026-01-01",
          removeBy: "2026-06-01",
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("namespace isolation (SKILL-007)", () => {
    it("parseSkillName parses namespaced skill", () => {
      const result = parseSkillName("acme-corp/code-review");
      expect(result.namespace).toBe("acme-corp");
      expect(result.name).toBe("code-review");
      expect(result.fullName).toBe("acme-corp/code-review");
    });

    it("parseSkillName parses unnamespaced skill", () => {
      const result = parseSkillName("code-review");
      expect(result.namespace).toBeUndefined();
      expect(result.name).toBe("code-review");
      expect(result.fullName).toBe("code-review");
    });

    it("isNamespacedSkill returns true for namespaced", () => {
      expect(isNamespacedSkill("acme/skill")).toBe(true);
    });

    it("isNamespacedSkill returns false for unnamespaced", () => {
      expect(isNamespacedSkill("skill")).toBe(false);
    });

    it("validateSkillNamespace passes for namespaced skill", () => {
      const skill: Skill = {
        ...validSkill,
        name: "acme-corp/code-review",
      };
      const result = validateSkillNamespace(skill);
      expect(result.valid).toBe(true);
    });

    it("validateSkillNamespace fails for unnamespaced skill", () => {
      const result = validateSkillNamespace(validSkill);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("must be namespaced");
    });

    it("validateSkillNamespace fails for invalid namespace", () => {
      const skill: Skill = {
        ...validSkill,
        name: "123invalid/skill",
      };
      const result = validateSkillNamespace(skill);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid namespace");
    });

    it("qualifySkillName adds namespace to unnamespaced", () => {
      expect(qualifySkillName("acme", "my-skill")).toBe("acme/my-skill");
    });

    it("qualifySkillName preserves existing namespace", () => {
      expect(qualifySkillName("acme", "other/my-skill")).toBe("other/my-skill");
    });

    it("skillNamesEqual compares case-insensitively", () => {
      expect(skillNamesEqual("Acme/Skill", "acme/skill")).toBe(true);
      expect(skillNamesEqual("acme/skill", "other/skill")).toBe(false);
    });

    it("skillBelongsToNamespace checks namespace ownership", () => {
      expect(skillBelongsToNamespace("acme/skill", "acme")).toBe(true);
      expect(skillBelongsToNamespace("acme/skill", "other")).toBe(false);
      expect(skillBelongsToNamespace("skill", "acme")).toBe(false);
    });
  });

  describe("skill composition (SKILL-008)", () => {
    const composedSkill: Skill = {
      ...validSkill,
      steps: [
        { skill: "acme/step-1", params: { input: "code" } },
        { skill: "acme/step-2", args: { mode: "strict" }, as: "result" },
      ],
    };

    it("isComposedSkill returns false for simple skill", () => {
      expect(isComposedSkill(validSkill)).toBe(false);
    });

    it("isComposedSkill returns true for composed skill", () => {
      expect(isComposedSkill(composedSkill)).toBe(true);
    });

    it("getComposedSkillDependencies returns empty for simple skill", () => {
      expect(getComposedSkillDependencies(validSkill)).toEqual([]);
    });

    it("getComposedSkillDependencies returns step skills", () => {
      const deps = getComposedSkillDependencies(composedSkill);
      expect(deps).toEqual(["acme/step-1", "acme/step-2"]);
    });

    it("resolveStepParams maps parent params", () => {
      const step: SkillStep = {
        skill: "child",
        params: { childInput: "parentInput" },
      };
      const result = resolveStepParams(step, { parentInput: "hello" });
      expect(result).toEqual({ childInput: "hello" });
    });

    it("resolveStepParams includes literal args", () => {
      const step: SkillStep = {
        skill: "child",
        args: { mode: "fast", count: 5 },
      };
      const result = resolveStepParams(step, {});
      expect(result).toEqual({ mode: "fast", count: 5 });
    });

    it("resolveStepParams combines args and params", () => {
      const step: SkillStep = {
        skill: "child",
        params: { input: "data" },
        args: { mode: "strict" },
      };
      const result = resolveStepParams(step, { data: "test-data" });
      expect(result).toEqual({ input: "test-data", mode: "strict" });
    });

    it("detectCircularDependency returns false for no deps", () => {
      const getSkill = (name: string): Skill | undefined => {
        if (name === "skill-a") return validSkill;
        return undefined;
      };
      const result = detectCircularDependency("skill-a", getSkill);
      expect(result.hasCircular).toBe(false);
    });

    it("detectCircularDependency detects self-reference", () => {
      const selfRefSkill: Skill = {
        ...validSkill,
        name: "self-ref",
        steps: [{ skill: "self-ref" }],
      };
      const getSkill = (name: string): Skill | undefined => {
        if (name === "self-ref") return selfRefSkill;
        return undefined;
      };
      const result = detectCircularDependency("self-ref", getSkill);
      expect(result.hasCircular).toBe(true);
      expect(result.cycle).toContain("self-ref");
    });

    it("detectCircularDependency detects indirect cycle", () => {
      const skillA: Skill = { ...validSkill, name: "a", steps: [{ skill: "b" }] };
      const skillB: Skill = { ...validSkill, name: "b", steps: [{ skill: "c" }] };
      const skillC: Skill = { ...validSkill, name: "c", steps: [{ skill: "a" }] };
      const skills: Record<string, Skill> = { a: skillA, b: skillB, c: skillC };
      const getSkill = (name: string): Skill | undefined => skills[name];

      const result = detectCircularDependency("a", getSkill);
      expect(result.hasCircular).toBe(true);
      expect(result.cycle).toEqual(["a", "b", "c", "a"]);
    });

    it("validates composed skill schema", () => {
      const result = validateSkill({
        ...validSkill,
        steps: [
          { skill: "acme/helper", params: { x: "y" }, args: { mode: "fast" }, as: "helper-result" },
          { skill: "acme/final", when: "helper-result.success" },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("access control (SKILL-010)", () => {
    it("getSkillVisibility returns default org-private", () => {
      expect(getSkillVisibility(validSkill)).toBe("org-private");
    });

    it("getSkillVisibility returns configured visibility", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "public" },
      };
      expect(getSkillVisibility(skill)).toBe("public");
    });

    it("canAccessSkill allows public skills for anyone", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "public" },
      };
      const result = canAccessSkill(skill, "acme", {});
      expect(result.allowed).toBe(true);
    });

    it("canAccessSkill allows org-private for same org", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "org-private" },
      };
      const result = canAccessSkill(skill, "acme", { orgId: "acme" });
      expect(result.allowed).toBe(true);
    });

    it("canAccessSkill denies org-private for different org", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "org-private" },
      };
      const result = canAccessSkill(skill, "acme", { orgId: "other" });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("private to organization");
    });

    it("canAccessSkill allows team-private for team members", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "team-private", allowedTeams: ["team-a", "team-b"] },
      };
      const context: AccessContext = { teamIds: ["team-b"] };
      const result = canAccessSkill(skill, "acme", context);
      expect(result.allowed).toBe(true);
    });

    it("canAccessSkill denies team-private for non-members", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "team-private", allowedTeams: ["team-a"] },
      };
      const context: AccessContext = { teamIds: ["team-c"] };
      const result = canAccessSkill(skill, "acme", context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("restricted to specific teams");
    });

    it("canAccessSkill allows project-private for project members", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "project-private", allowedProjects: ["proj-1"] },
      };
      const context: AccessContext = { projectIds: ["proj-1"] };
      const result = canAccessSkill(skill, "acme", context);
      expect(result.allowed).toBe(true);
    });

    it("canInstallSkill returns true by default", () => {
      expect(canInstallSkill(validSkill)).toBe(true);
    });

    it("canInstallSkill respects allowInstall flag", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "public", allowInstall: false },
      };
      expect(canInstallSkill(skill)).toBe(false);
    });

    it("canForkSkill returns true by default", () => {
      expect(canForkSkill(validSkill)).toBe(true);
    });

    it("canForkSkill respects allowFork flag", () => {
      const skill: Skill = {
        ...validSkill,
        access: { visibility: "public", allowFork: false },
      };
      expect(canForkSkill(skill)).toBe(false);
    });

    it("validates access control schema", () => {
      const result = validateSkill({
        ...validSkill,
        access: {
          visibility: "team-private",
          allowedTeams: ["team-a", "team-b"],
          allowInstall: true,
          allowFork: false,
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("testing framework (SKILL-009)", () => {
    const skillWithTests: Skill = {
      ...validSkill,
      tests: [
        {
          name: "basic test",
          params: { language: "typescript" },
          expect: [{ type: "contains", value: "review" }],
        },
        {
          name: "skipped test",
          params: {},
          expect: [{ type: "equals", value: "exact" }],
          skip: true,
        },
      ],
    };

    it("hasTests returns false for skill without tests", () => {
      expect(hasTests(validSkill)).toBe(false);
    });

    it("hasTests returns true for skill with tests", () => {
      expect(hasTests(skillWithTests)).toBe(true);
    });

    it("getRunnableTests filters out skipped tests", () => {
      const runnable = getRunnableTests(skillWithTests);
      expect(runnable).toHaveLength(1);
      expect(runnable[0]?.name).toBe("basic test");
    });

    it("runAssertion passes contains assertion", () => {
      const assertion: SkillTestAssertion = { type: "contains", value: "hello" };
      const result = runAssertion(assertion, "hello world");
      expect(result.passed).toBe(true);
    });

    it("runAssertion fails contains assertion", () => {
      const assertion: SkillTestAssertion = { type: "contains", value: "goodbye" };
      const result = runAssertion(assertion, "hello world");
      expect(result.passed).toBe(false);
    });

    it("runAssertion passes equals assertion", () => {
      const assertion: SkillTestAssertion = { type: "equals", value: "exact match" };
      const result = runAssertion(assertion, "exact match");
      expect(result.passed).toBe(true);
    });

    it("runAssertion passes matches assertion", () => {
      const assertion: SkillTestAssertion = { type: "matches", value: "\\d{3}-\\d{4}" };
      const result = runAssertion(assertion, "Call 555-1234 now");
      expect(result.passed).toBe(true);
    });

    it("runAssertion passes json-path assertion", () => {
      const assertion: SkillTestAssertion = { type: "json-path", path: "$.status", value: "ok" };
      const result = runAssertion(assertion, '{"status": "ok", "count": 5}');
      expect(result.passed).toBe(true);
    });

    it("runAssertion handles NOT assertion", () => {
      const assertion: SkillTestAssertion = { type: "contains", value: "error", not: true };
      const result = runAssertion(assertion, "success response");
      expect(result.passed).toBe(true);
    });

    it("validates skill with test cases", () => {
      const result = validateSkill(skillWithTests);
      expect(result.valid).toBe(true);
    });
  });
});
