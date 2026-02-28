import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CanonicalInstruction, ToolAdapter } from "@laup/core";

const GENERATED_HEADER = "laup:generated — do not edit directly, edit laup.md instead";

/**
 * Cursor adapter — renders canonical instruction to both cursor formats:
 * - Legacy: `.cursorrules` (plain Markdown)
 * - MDC: `.cursor/rules/laup.mdc` (YAML frontmatter + Markdown body)
 *
 * Both formats are written simultaneously to support DOC-105 dual-format migration.
 */
export class CursorAdapter implements ToolAdapter {
  readonly toolId = "cursor";
  readonly displayName = "Cursor";
  readonly category = "ide" as const;

  renderLegacy(doc: CanonicalInstruction): string {
    const lines = [`<!-- ${GENERATED_HEADER} -->`, "", doc.body];
    return lines.join("\n").trimEnd();
  }

  renderMdc(doc: CanonicalInstruction): string {
    const overrides = doc.frontmatter.tools?.cursor;
    const frontmatterLines: string[] = [`description: "${GENERATED_HEADER}"`];

    if (overrides?.globs && overrides.globs.length > 0) {
      frontmatterLines.push("globs:");
      for (const glob of overrides.globs) {
        frontmatterLines.push(`  - "${glob}"`);
      }
    }

    if (overrides?.alwaysApply !== undefined) {
      frontmatterLines.push(`alwaysApply: ${overrides.alwaysApply}`);
    }

    const lines = ["---", ...frontmatterLines, "---", "", doc.body];
    return lines.join("\n").trimEnd();
  }

  /** Returns [legacyContent, mdcContent] */
  render(doc: CanonicalInstruction): string[] {
    return [this.renderLegacy(doc), this.renderMdc(doc)];
  }

  write(rendered: string | string[], targetDir: string): string[] {
    const [legacy, mdc] = Array.isArray(rendered) ? rendered : [rendered, rendered];
    const written: string[] = [];

    mkdirSync(targetDir, { recursive: true });

    const legacyPath = join(targetDir, ".cursorrules");
    writeFileSync(legacyPath, `${legacy}\n`, "utf-8");
    written.push(legacyPath);

    const mdcDir = join(targetDir, ".cursor", "rules");
    mkdirSync(mdcDir, { recursive: true });
    const mdcPath = join(mdcDir, "laup.mdc");
    writeFileSync(mdcPath, `${mdc}\n`, "utf-8");
    written.push(mdcPath);

    return written;
  }
}

export const cursorAdapter = new CursorAdapter();
