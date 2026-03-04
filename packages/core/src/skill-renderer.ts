import type { Skill } from "./skill-schema.js";

/**
 * Skill renderer interface (SKILL-002).
 * Compiles a portable skill into a tool's native format.
 */
export interface SkillRenderer {
  /** Tool ID this renderer targets */
  readonly toolId: string;

  /** Human-readable tool name */
  readonly displayName: string;

  /**
   * Render a skill to the tool's native format.
   * Returns the rendered content as a string.
   */
  render(skill: Skill): string;

  /**
   * Get the filename for the rendered skill.
   */
  getFilename(skill: Skill): string;
}

function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n");
}

/**
 * Convert a slash command (e.g. "/review") into a filesystem-safe base name.
 * Slash-command-capable tools resolve command names from file names, so this
 * must be derived from trigger.command (not skill.name).
 */
function commandFileBaseName(skill: Skill): string {
  const command = skill.trigger.command.startsWith("/")
    ? skill.trigger.command.slice(1)
    : skill.trigger.command;
  return command.replace(/[^a-z0-9-]/gi, "-");
}

function renderMarkdownSkill(skill: Skill): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${skill.name}`);
  lines.push("");
  lines.push(skill.description);
  lines.push("");

  // Trigger
  lines.push("## Trigger");
  lines.push("");
  lines.push(`\`${skill.trigger.command}\``);
  if (skill.trigger.aliases && skill.trigger.aliases.length > 0) {
    lines.push("");
    lines.push(`Aliases: ${skill.trigger.aliases.join(", ")}`);
  }
  lines.push("");

  // Parameters
  if (skill.parameters.length > 0) {
    lines.push("## Parameters");
    lines.push("");
    lines.push("Prompt for all required parameters when this command is invoked.");
    lines.push("");
    for (const param of skill.parameters) {
      const required = param.required ? "(required)" : "(optional)";
      const defaultVal = param.default !== undefined ? ` [default: ${param.default}]` : "";
      lines.push(`- **${param.name}** \`${param.type}\` ${required}${defaultVal}`);
      if (param.description) {
        lines.push(`  ${param.description}`);
      }
      if (param.options) {
        lines.push(`  Options: ${param.options.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Prompt template
  lines.push("## Prompt");
  lines.push("");
  if (skill.system) {
    lines.push("**System:**");
    lines.push("```");
    lines.push(skill.system);
    lines.push("```");
    lines.push("");
  }
  lines.push("**User:**");
  lines.push("```");
  lines.push(skill.prompt);
  lines.push("```");
  lines.push("");

  // Metadata
  if (skill.metadata) {
    lines.push("## Metadata");
    lines.push("");
    if (skill.metadata.author) {
      lines.push(`- Author: ${skill.metadata.author}`);
    }
    if (skill.metadata.license) {
      lines.push(`- License: ${skill.metadata.license}`);
    }
    if (skill.metadata.tags && skill.metadata.tags.length > 0) {
      lines.push(`- Tags: ${skill.metadata.tags.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Claude Code skill renderer.
 * Renders skills as markdown with slash command documentation.
 */
export class ClaudeCodeSkillRenderer implements SkillRenderer {
  readonly toolId = "claude-code";
  readonly displayName = "Claude Code";

  render(skill: Skill): string {
    return renderMarkdownSkill(skill);
  }

  getFilename(skill: Skill): string {
    return `${commandFileBaseName(skill)}.md`;
  }
}

/**
 * Codex skill renderer.
 * Uses markdown command files derived from slash command names.
 */
export class CodexSkillRenderer implements SkillRenderer {
  readonly toolId = "codex";
  readonly displayName = "Codex CLI";

  render(skill: Skill): string {
    return renderMarkdownSkill(skill);
  }

  getFilename(skill: Skill): string {
    return `${commandFileBaseName(skill)}.md`;
  }
}

/**
 * OpenCode skill renderer.
 * Uses markdown command files derived from slash command names.
 */
export class OpenCodeSkillRenderer implements SkillRenderer {
  readonly toolId = "opencode";
  readonly displayName = "OpenCode";

  render(skill: Skill): string {
    return renderMarkdownSkill(skill);
  }

  getFilename(skill: Skill): string {
    return `${commandFileBaseName(skill)}.md`;
  }
}

/**
 * GitHub Copilot skill renderer.
 * Uses markdown command files derived from slash command names.
 */
export class CopilotSkillRenderer implements SkillRenderer {
  readonly toolId = "copilot";
  readonly displayName = "GitHub Copilot";

  render(skill: Skill): string {
    return renderMarkdownSkill(skill);
  }

  getFilename(skill: Skill): string {
    return `${commandFileBaseName(skill)}.md`;
  }
}

/**
 * Cursor skill renderer.
 * Renders skills as MDC files with YAML frontmatter.
 */
export class CursorSkillRenderer implements SkillRenderer {
  readonly toolId = "cursor";
  readonly displayName = "Cursor";

  render(skill: Skill): string {
    const lines: string[] = [];

    // YAML frontmatter
    lines.push("---");
    lines.push(`description: "${escapeYamlDoubleQuoted(skill.description)}"`);
    if (skill.tools?.["cursor"]) {
      const cursorOverrides = skill.tools["cursor"] as Record<string, unknown>;
      if (cursorOverrides["globs"]) {
        lines.push("globs:");
        for (const glob of cursorOverrides["globs"] as string[]) {
          lines.push(`  - "${glob}"`);
        }
      }
      if (cursorOverrides["alwaysApply"] !== undefined) {
        lines.push(`alwaysApply: ${cursorOverrides["alwaysApply"]}`);
      }
    }
    lines.push("---");
    lines.push("");

    // Title and description
    lines.push(`# ${skill.name}`);
    lines.push("");
    lines.push(`**Trigger:** \`${skill.trigger.command}\``);
    lines.push("");

    // Parameters as structured instructions
    if (skill.parameters.length > 0) {
      lines.push("## Parameters");
      lines.push("");
      lines.push("Prompt for all required parameters when this command is invoked.");
      lines.push("");
      for (const param of skill.parameters) {
        const required = param.required ? "required" : "optional";
        lines.push(
          `- \`{{${param.name}}}\`: ${param.description || param.name} (${required}, ${param.type})`,
        );
      }
      lines.push("");
    }

    // Prompt
    lines.push("## Instructions");
    lines.push("");
    if (skill.system) {
      lines.push(skill.system);
      lines.push("");
    }
    lines.push(skill.prompt);

    return lines.join("\n").trimEnd();
  }

  getFilename(skill: Skill): string {
    return `${commandFileBaseName(skill)}.mdc`;
  }
}

/**
 * Aider skill renderer.
 * Renders skills as markdown convention files.
 */
export class AiderSkillRenderer implements SkillRenderer {
  readonly toolId = "aider";
  readonly displayName = "Aider";

  render(skill: Skill): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Skill: ${skill.name}`);
    lines.push("");
    lines.push(skill.description);
    lines.push("");

    // Trigger
    lines.push("## Invocation");
    lines.push("");
    lines.push(`Use \`${skill.trigger.command}\` to invoke this skill.`);
    lines.push("");

    // Parameters
    if (skill.parameters.length > 0) {
      lines.push("## Parameters");
      lines.push("");
      lines.push("When invoking, provide these parameters:");
      lines.push("");
      for (const param of skill.parameters) {
        const required = param.required ? "required" : "optional";
        lines.push(`- **${param.name}** (${param.type}, ${required}): ${param.description || ""}`);
        if (param.default !== undefined) {
          lines.push(`  Default: \`${param.default}\``);
        }
      }
      lines.push("");
    }

    // Instructions
    lines.push("## Instructions");
    lines.push("");
    if (skill.system) {
      lines.push(skill.system);
      lines.push("");
    }
    lines.push(skill.prompt);

    return lines.join("\n").trimEnd();
  }

  getFilename(skill: Skill): string {
    const safeName = skill.name.replace(/[^a-z0-9-]/gi, "-");
    return `SKILL-${safeName.toUpperCase()}.md`;
  }
}

/**
 * Registry of skill renderers.
 */
export const skillRenderers: Record<string, SkillRenderer> = {
  "claude-code": new ClaudeCodeSkillRenderer(),
  codex: new CodexSkillRenderer(),
  opencode: new OpenCodeSkillRenderer(),
  copilot: new CopilotSkillRenderer(),
  cursor: new CursorSkillRenderer(),
  aider: new AiderSkillRenderer(),
};

/**
 * Get a skill renderer by tool ID.
 */
export function getSkillRenderer(toolId: string): SkillRenderer | undefined {
  return skillRenderers[toolId];
}

/**
 * Render a skill to all supported tools.
 */
export function renderSkillToAllTools(skill: Skill): Array<{
  toolId: string;
  filename: string;
  content: string;
}> {
  return Object.values(skillRenderers).map((renderer) => ({
    toolId: renderer.toolId,
    filename: renderer.getFilename(skill),
    content: renderer.render(skill),
  }));
}
