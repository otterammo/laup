import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";
import { dump } from "js-yaml";

const CONVENTIONS_FILE = "CONVENTIONS.md";
const GENERATED_COMMENT = "# laup:generated — do not edit directly, edit laup.md instead";

interface AiderOverrides {
  model?: string;
  editorModel?: string;
  autoCommits?: boolean;
  read?: string[];
}

interface AiderYamlConfig {
  model?: string;
  "editor-model"?: string;
  "auto-commits"?: boolean;
  read?: string[];
}

/**
 * Aider adapter — two-file write strategy (ADR-001 §7.8):
 * - `.aider.conf.yml`: points to CONVENTIONS.md via `read:` key
 * - `CONVENTIONS.md`: the canonical instruction body
 */
export class AiderAdapter implements ToolAdapter {
  readonly toolId = "aider";
  readonly displayName = "Aider";

  renderConfig(doc: CanonicalInstruction): string {
    const overrides = doc.frontmatter.tools?.aider as AiderOverrides | undefined;

    const config: AiderYamlConfig = {};

    if (overrides?.model) {
      config.model = overrides.model;
    }

    if (overrides?.editorModel) {
      config["editor-model"] = overrides.editorModel;
    }

    if (overrides?.autoCommits !== undefined) {
      config["auto-commits"] = overrides.autoCommits;
    }

    // Merge user-specified reads with the required CONVENTIONS.md pointer
    const userReads = overrides?.read ?? [];
    const allReads = [CONVENTIONS_FILE, ...userReads.filter((r) => r !== CONVENTIONS_FILE)];
    config.read = allReads;

    return `${GENERATED_COMMENT}\n${dump(config, { lineWidth: -1 }).trimEnd()}\n`;
  }

  renderConventions(doc: CanonicalInstruction): string {
    return `<!-- laup:generated — do not edit directly, edit laup.md instead -->\n\n${doc.body.trimEnd()}\n`;
  }

  /** Returns [configContent, conventionsContent] */
  render(doc: CanonicalInstruction): string[] {
    return [this.renderConfig(doc), this.renderConventions(doc)];
  }

  write(rendered: string | string[], targetDir: string): string[] {
    const [config, conventions] = (Array.isArray(rendered) ? rendered : [rendered, rendered]) as [
      string,
      string,
    ];

    mkdirSync(targetDir, { recursive: true });

    const configPath = join(targetDir, ".aider.conf.yml");
    writeFileSync(configPath, config, "utf-8");

    const conventionsPath = join(targetDir, CONVENTIONS_FILE);
    writeFileSync(conventionsPath, conventions, "utf-8");

    return [configPath, conventionsPath];
  }
}

export const aiderAdapter = new AiderAdapter();
