import { describe, expect, it } from "vitest";
import {
  getDeprecationNotice,
  isSkillDeprecated,
  parseSkill,
  renderSkillPrompt,
  type Skill,
  validateSkill,
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
});
