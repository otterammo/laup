import type { CanonicalInstruction } from "@laup/core";

export interface MergeChange {
  actor: string;
  document: CanonicalInstruction;
}

export interface MergeResult {
  merged: CanonicalInstruction;
  conflicts: string[];
  autoMerged: boolean;
  actors: string[];
}

function mergeToolOverrides(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  conflicts: string[],
  pathPrefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  for (const [k, v] of Object.entries(incoming)) {
    const path = `${pathPrefix}.${k}`;
    if (!(k in out)) {
      out[k] = v;
      continue;
    }

    const existing = out[k];
    if (JSON.stringify(existing) !== JSON.stringify(v)) {
      conflicts.push(path);
    }
  }

  return out;
}

/**
 * Auto-merge additive non-conflicting changes.
 * - additive fields are merged
 * - conflicting edits on same field are reported as conflicts
 */
export function autoMergeAdditive(base: CanonicalInstruction, changes: MergeChange[]): MergeResult {
  const merged: CanonicalInstruction = JSON.parse(JSON.stringify(base)) as CanonicalInstruction;
  const conflicts: string[] = [];
  const actors = [...new Set(changes.map((c) => c.actor))];

  for (const change of changes) {
    // Body conflict: different full body content = conflict.
    if (change.document.body !== base.body && change.document.body !== merged.body) {
      conflicts.push("body");
    } else if (change.document.body !== base.body) {
      merged.body = change.document.body;
    }

    // Metadata additive merge
    const meta = change.document.frontmatter.metadata;
    if (meta) {
      merged.frontmatter.metadata ??= {};
      for (const [k, v] of Object.entries(meta)) {
        const existing = merged.frontmatter.metadata[k as keyof typeof merged.frontmatter.metadata];
        if (existing === undefined) {
          // biome-ignore lint/suspicious/noExplicitAny: dynamic metadata assignment
          (merged.frontmatter.metadata as any)[k] = v;
        } else if (JSON.stringify(existing) !== JSON.stringify(v)) {
          conflicts.push(`metadata.${k}`);
        }
      }
    }

    // Tool overrides additive merge
    const tools = change.document.frontmatter.tools;
    if (tools) {
      merged.frontmatter.tools ??= {};
      for (const [toolId, override] of Object.entries(tools)) {
        if (!override) continue;
        const current = merged.frontmatter.tools[toolId as keyof typeof merged.frontmatter.tools];
        if (!current) {
          // biome-ignore lint/suspicious/noExplicitAny: dynamic tool assignment
          (merged.frontmatter.tools as any)[toolId] = override;
          continue;
        }

        const next = mergeToolOverrides(
          current as Record<string, unknown>,
          override as Record<string, unknown>,
          conflicts,
          `tools.${toolId}`,
        );
        // biome-ignore lint/suspicious/noExplicitAny: dynamic tool assignment
        (merged.frontmatter.tools as any)[toolId] = next;
      }
    }
  }

  return {
    merged,
    conflicts,
    autoMerged: conflicts.length === 0,
    actors,
  };
}
