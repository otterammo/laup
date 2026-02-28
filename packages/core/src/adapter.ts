import type { CanonicalInstruction } from "./schema.js";

/** Tool category for selective propagation filtering (CONF-015) */
export type ToolCategory = "ide" | "cli" | "agent" | "other";

/**
 * Contract every tool adapter must implement.
 * Adapters are pure functions: render() is stateless, write() is the only side effect.
 */
export interface ToolAdapter {
  /** Unique identifier matching the tool key in canonical frontmatter (ADR-001 §7.3) */
  readonly toolId: string;

  /** Human-readable tool name for CLI output */
  readonly displayName: string;

  /** Tool category for filtering (CONF-015). Default: "other" */
  readonly category?: ToolCategory;

  /**
   * Render a canonical instruction document to the tool's native string format.
   * Must be deterministic and side-effect-free.
   */
  render(doc: CanonicalInstruction): string | string[];

  /**
   * Write rendered output to the target directory.
   * Returns the list of file paths written.
   */
  write(rendered: string | string[], targetDir: string): string[];
}
