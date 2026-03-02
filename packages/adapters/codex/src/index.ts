import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";

/**
 * OpenAI Codex CLI adapter — renders canonical instruction to AGENTS.md.
 * See: https://agents.md
 * See: https://developers.openai.com/codex
 */
export class CodexAdapter implements ToolAdapter {
  readonly toolId = "codex";
  readonly displayName = "Codex CLI";
  readonly category = "cli" as const;

  render(doc: CanonicalInstruction): string {
    const lines: string[] = [
      "<!-- laup:generated — do not edit directly, edit laup.md instead -->",
      "",
      doc.body,
    ];
    return lines.join("\n").trimEnd();
  }

  write(rendered: string, targetDir: string): string[] {
    mkdirSync(targetDir, { recursive: true });
    const outPath = join(targetDir, "AGENTS.md");
    writeFileSync(outPath, `${rendered}\n`, "utf-8");
    return [outPath];
  }

  getOutputPaths(targetDir: string): string[] {
    return [join(targetDir, "AGENTS.md")];
  }
}

export const codexAdapter = new CodexAdapter();
