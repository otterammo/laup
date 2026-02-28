import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";

/**
 * Claude Code adapter — renders canonical instruction to CLAUDE.md.
 * ADR-001 §7.7: Direct Markdown pass-through.
 */
export class ClaudeCodeAdapter implements ToolAdapter {
  readonly toolId = "claude-code";
  readonly displayName = "Claude Code";
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
    const outPath = join(targetDir, "CLAUDE.md");
    writeFileSync(outPath, `${rendered}\n`, "utf-8");
    return [outPath];
  }

  getOutputPaths(targetDir: string): string[] {
    return [join(targetDir, "CLAUDE.md")];
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
