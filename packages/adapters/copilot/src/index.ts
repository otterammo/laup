import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";

/**
 * GitHub Copilot adapter — renders canonical instruction to .github/copilot-instructions.md.
 * See: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot
 */
export class CopilotAdapter implements ToolAdapter {
  readonly toolId = "copilot";
  readonly displayName = "GitHub Copilot";
  readonly category = "ide" as const;

  render(doc: CanonicalInstruction): string {
    const lines: string[] = [
      "<!-- laup:generated — do not edit directly, edit laup.md instead -->",
      "",
      doc.body,
    ];
    return lines.join("\n").trimEnd();
  }

  write(rendered: string, targetDir: string): string[] {
    const githubDir = join(targetDir, ".github");
    mkdirSync(githubDir, { recursive: true });

    const outPath = join(githubDir, "copilot-instructions.md");
    writeFileSync(outPath, `${rendered}\n`, "utf-8");
    return [outPath];
  }

  getOutputPaths(targetDir: string): string[] {
    return [join(targetDir, ".github", "copilot-instructions.md")];
  }
}

export const copilotAdapter = new CopilotAdapter();
