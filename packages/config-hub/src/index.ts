import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ToolAdapter, ValidationResult } from "@laup/core";
import { parseCanonical, validateCanonical } from "@laup/core";

export type { ValidationResult };

export interface SyncResult {
  tool: string;
  success: boolean;
  paths: string[];
  error?: string;
}

export interface SyncOptions {
  /** Absolute or relative path to the canonical instruction file. */
  source: string;
  /** Tool IDs to sync. Pass empty array to sync all registered adapters. */
  tools: string[];
  /** Target directory for output files. Defaults to source file's directory. */
  outputDir?: string;
  /** When true, skip writing files and return what would be written. */
  dryRun?: boolean;
}

export class SyncEngine {
  private adapters: Map<string, ToolAdapter>;

  constructor(adapters: ToolAdapter[]) {
    this.adapters = new Map(adapters.map((a) => [a.toolId, a]));
  }

  get registeredTools(): string[] {
    return [...this.adapters.keys()];
  }

  validate(source: string): ValidationResult {
    const content = readFileSync(resolve(source), "utf-8");
    return validateCanonical(content);
  }

  sync(options: SyncOptions): SyncResult[] {
    const sourcePath = resolve(options.source);
    const targetDir = options.outputDir ?? dirname(sourcePath);
    const toolIds = options.tools.length > 0 ? options.tools : this.registeredTools;
    const results: SyncResult[] = [];

    const doc = parseCanonical(sourcePath);

    for (const toolId of toolIds) {
      const adapter = this.adapters.get(toolId);
      if (!adapter) {
        results.push({
          tool: toolId,
          success: false,
          paths: [],
          error: `No adapter registered for tool: ${toolId}`,
        });
        continue;
      }

      try {
        const rendered = adapter.render(doc);
        const paths = options.dryRun ? [] : adapter.write(rendered, targetDir);
        results.push({ tool: toolId, success: true, paths });
      } catch (err) {
        results.push({
          tool: toolId,
          success: false,
          paths: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }
}
