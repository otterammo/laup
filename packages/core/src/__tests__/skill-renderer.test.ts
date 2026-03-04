import { describe, expect, it } from "vitest";
import {
  AiderSkillRenderer,
  ClaudeCodeSkillRenderer,
  CodexSkillRenderer,
  CopilotSkillRenderer,
  CursorSkillRenderer,
  getSkillRenderer,
  OpenCodeSkillRenderer,
  renderSkillToAllTools,
} from "../skill-renderer.js";
import type { Skill } from "../skill-schema.js";

const sampleSkill: Skill = {
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
  system: "You are a senior code reviewer.",
  metadata: {
    author: "laup",
    license: "MIT",
    tags: ["code", "review"],
  },
};

describe("skill-renderer", () => {
  describe("ClaudeCodeSkillRenderer", () => {
    const renderer = new ClaudeCodeSkillRenderer();

    it("renders skill as markdown", () => {
      const output = renderer.render(sampleSkill);

      expect(output).toContain("# code-review");
      expect(output).toContain("Review code for best practices");
      expect(output).toContain("`/review`");
      expect(output).toContain("Aliases: code review, review code");
      expect(output).toContain("**language** `string` (required)");
      expect(output).toContain("**focus** `selection` (optional)");
      expect(output).toContain("You are a senior code reviewer");
      expect(output).toContain("{{language}}");
      expect(output).toContain("Prompt for all required parameters when this command is invoked");
    });

    it("generates command-based filename", () => {
      const filename = renderer.getFilename(sampleSkill);
      expect(filename).toBe("review.md");
    });

    it("handles skill without optional fields", () => {
      const minimalSkill: Skill = {
        schemaVersion: "1.0",
        name: "simple",
        version: "1.0.0",
        description: "A simple skill",
        parameters: [],
        trigger: { command: "/simple" },
        prompt: "Do something simple",
      };

      const output = renderer.render(minimalSkill);
      expect(output).toContain("# simple");
      expect(output).toContain("Do something simple");
      expect(output).not.toContain("## Parameters");
    });
  });

  describe("CursorSkillRenderer", () => {
    const renderer = new CursorSkillRenderer();

    it("renders skill as MDC with frontmatter", () => {
      const output = renderer.render(sampleSkill);

      expect(output).toContain("---");
      expect(output).toContain('description: "Review code for best practices');
      expect(output).toContain("# code-review");
      expect(output).toContain("**Trigger:** `/review`");
      expect(output).toContain("`{{language}}`");
      expect(output).toContain("Prompt for all required parameters when this command is invoked");
    });

    it("includes cursor-specific overrides", () => {
      const skillWithOverrides: Skill = {
        ...sampleSkill,
        tools: {
          cursor: {
            globs: ["**/*.ts", "**/*.tsx"],
            alwaysApply: true,
          },
        },
      };

      const output = renderer.render(skillWithOverrides);
      expect(output).toContain("globs:");
      expect(output).toContain('"**/*.ts"');
      expect(output).toContain("alwaysApply: true");
    });

    it("generates command-based filename", () => {
      const filename = renderer.getFilename(sampleSkill);
      expect(filename).toBe("review.mdc");
    });
  });

  describe("AiderSkillRenderer", () => {
    const renderer = new AiderSkillRenderer();

    it("renders skill as markdown", () => {
      const output = renderer.render(sampleSkill);

      expect(output).toContain("# Skill: code-review");
      expect(output).toContain("Use `/review` to invoke");
      expect(output).toContain("**language** (string, required)");
      expect(output).toContain("Default: `maintainability`");
    });

    it("generates correct filename", () => {
      const filename = renderer.getFilename(sampleSkill);
      expect(filename).toBe("SKILL-CODE-REVIEW.md");
    });
  });

  describe("additional markdown renderers", () => {
    it("generate command-based filenames", () => {
      expect(new CodexSkillRenderer().getFilename(sampleSkill)).toBe("review.md");
      expect(new OpenCodeSkillRenderer().getFilename(sampleSkill)).toBe("review.md");
      expect(new CopilotSkillRenderer().getFilename(sampleSkill)).toBe("review.md");
    });
  });

  describe("getSkillRenderer", () => {
    it("returns renderer for known tool", () => {
      expect(getSkillRenderer("claude-code")).toBeInstanceOf(ClaudeCodeSkillRenderer);
      expect(getSkillRenderer("codex")).toBeInstanceOf(CodexSkillRenderer);
      expect(getSkillRenderer("opencode")).toBeInstanceOf(OpenCodeSkillRenderer);
      expect(getSkillRenderer("copilot")).toBeInstanceOf(CopilotSkillRenderer);
      expect(getSkillRenderer("cursor")).toBeInstanceOf(CursorSkillRenderer);
      expect(getSkillRenderer("aider")).toBeInstanceOf(AiderSkillRenderer);
    });

    it("returns undefined for unknown tool", () => {
      expect(getSkillRenderer("unknown-tool")).toBeUndefined();
    });
  });

  describe("renderSkillToAllTools", () => {
    it("renders skill to all tools", () => {
      const results = renderSkillToAllTools(sampleSkill);

      expect(results).toHaveLength(6);
      expect(results.map((r) => r.toolId).sort()).toEqual([
        "aider",
        "claude-code",
        "codex",
        "copilot",
        "cursor",
        "opencode",
      ]);

      for (const result of results) {
        expect(result.filename).toBeTruthy();
        expect(result.content).toBeTruthy();
        expect(result.content).toContain("code-review");
      }
    });
  });
});
