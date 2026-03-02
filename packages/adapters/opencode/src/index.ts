import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";

/**
 * OpenCode tool-specific overrides.
 */
interface OpenCodeOverrides {
  model?: string;
  maxTokens?: number;
  autoCompact?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
}

interface McpServerConfig {
  type: "stdio" | "http" | "sse";
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface OpenCodeConfig {
  _generated?: string;
  agents?: {
    coder?: {
      model?: string;
      maxTokens?: number;
    };
  };
  autoCompact?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * OpenCode / Crush adapter — renders canonical instruction to AGENTS.md
 * and optionally generates .opencode.json when tool-specific overrides exist.
 *
 * See: https://github.com/charmbracelet/crush
 * See: https://agents.md
 */
export class OpenCodeAdapter implements ToolAdapter {
  readonly toolId = "opencode";
  readonly displayName = "OpenCode";
  readonly category = "cli" as const;

  renderAgents(doc: CanonicalInstruction): string {
    const lines: string[] = [
      "<!-- laup:generated — do not edit directly, edit laup.md instead -->",
      "",
      doc.body,
    ];
    return lines.join("\n").trimEnd();
  }

  renderConfig(doc: CanonicalInstruction): string | null {
    const overrides = doc.frontmatter.tools?.opencode as OpenCodeOverrides | undefined;
    if (!overrides) return null;

    const config: OpenCodeConfig = {
      _generated: "laup:generated — do not edit directly, edit laup.md instead",
    };

    if (overrides.model || overrides.maxTokens) {
      const coder: { model?: string; maxTokens?: number } = {};
      if (overrides.model) {
        coder.model = overrides.model;
      }
      if (overrides.maxTokens) {
        coder.maxTokens = overrides.maxTokens;
      }
      config.agents = { coder };
    }

    if (overrides.autoCompact !== undefined) {
      config.autoCompact = overrides.autoCompact;
    }

    if (overrides.mcpServers) {
      config.mcpServers = overrides.mcpServers;
    }

    return JSON.stringify(config, null, 2);
  }

  /**
   * Returns [agentsContent, configContent | null]
   */
  render(doc: CanonicalInstruction): string[] {
    const agents = this.renderAgents(doc);
    const config = this.renderConfig(doc);
    return config ? [agents, config] : [agents];
  }

  write(rendered: string | string[], targetDir: string): string[] {
    const [agents, config] = Array.isArray(rendered) ? rendered : [rendered, undefined];
    const written: string[] = [];

    mkdirSync(targetDir, { recursive: true });

    const agentsPath = join(targetDir, "AGENTS.md");
    writeFileSync(agentsPath, `${agents}\n`, "utf-8");
    written.push(agentsPath);

    if (config) {
      const configPath = join(targetDir, ".opencode.json");
      writeFileSync(configPath, `${config}\n`, "utf-8");
      written.push(configPath);
    }

    return written;
  }

  getOutputPaths(targetDir: string): string[] {
    return [join(targetDir, "AGENTS.md"), join(targetDir, ".opencode.json")];
  }
}

export const openCodeAdapter = new OpenCodeAdapter();
