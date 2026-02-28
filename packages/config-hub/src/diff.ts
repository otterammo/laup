/**
 * Simple line-based diff utility for comparing rendered outputs (CONF-020).
 * Produces unified diff format for human readability.
 */

export interface DiffLine {
  type: "context" | "add" | "remove";
  content: string;
  lineNumber?: number;
}

export interface DiffResult {
  hasChanges: boolean;
  lines: DiffLine[];
  summary: {
    added: number;
    removed: number;
    unchanged: number;
  };
}

/**
 * Compute a simple line-by-line diff between two strings.
 * Uses a basic LCS-based approach for small files.
 */
export function computeDiff(oldContent: string, newContent: string): DiffResult {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  // Simple Myers-like diff using LCS
  const lcs = longestCommonSubsequence(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const oldLine = oldLines[oldIdx];
    const newLine = newLines[newIdx];
    const lcsLine = lcs[lcsIdx];

    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLine === lcsLine) {
      // Match in old - check if it's also current in new
      if (newIdx < newLines.length && newLine === lcsLine) {
        lines.push({ type: "context", content: oldLine ?? "" });
        unchanged++;
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else if (newIdx < newLines.length && newLine !== undefined) {
        // New has something different before matching
        lines.push({ type: "add", content: newLine, lineNumber: newIdx + 1 });
        added++;
        newIdx++;
      } else if (oldLine !== undefined) {
        // Old still has content
        lines.push({ type: "remove", content: oldLine, lineNumber: oldIdx + 1 });
        removed++;
        oldIdx++;
      }
    } else if (oldIdx < oldLines.length && oldLine !== undefined) {
      lines.push({ type: "remove", content: oldLine, lineNumber: oldIdx + 1 });
      removed++;
      oldIdx++;
    } else if (newIdx < newLines.length && newLine !== undefined) {
      lines.push({ type: "add", content: newLine, lineNumber: newIdx + 1 });
      added++;
      newIdx++;
    } else {
      // Safety valve to prevent infinite loop
      oldIdx++;
      newIdx++;
    }
  }

  return {
    hasChanges: added > 0 || removed > 0,
    lines,
    summary: { added, removed, unchanged },
  };
}

/**
 * Find longest common subsequence of two arrays (for diff computation).
 */
function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const row = dp[i];
      const prevRow = dp[i - 1];
      if (!row || !prevRow) continue;

      if (a[i - 1] === b[j - 1]) {
        row[j] = (prevRow[j - 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
      }
    }
  }

  // Backtrack to find the actual LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const aVal = a[i - 1];
    const bVal = b[j - 1];
    const dpUp = dp[i - 1]?.[j] ?? 0;
    const dpLeft = dp[i]?.[j - 1] ?? 0;

    if (aVal !== undefined && aVal === bVal) {
      lcs.unshift(aVal);
      i--;
      j--;
    } else if (dpUp > dpLeft) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * Format diff result as unified diff string.
 */
export function formatDiff(diff: DiffResult, contextLines = 3): string {
  if (!diff.hasChanges) {
    return "(no changes)";
  }

  const output: string[] = [];
  const lines = diff.lines;

  // Simple approach: output all lines with prefixes
  for (const line of lines) {
    switch (line.type) {
      case "add":
        output.push(`+${line.content}`);
        break;
      case "remove":
        output.push(`-${line.content}`);
        break;
      case "context":
        output.push(` ${line.content}`);
        break;
    }
  }

  // Trim excessive context (keep only contextLines around changes)
  const result: string[] = [];
  let lastChangeIdx = -contextLines - 1;

  for (let i = 0; i < output.length; i++) {
    const line = output[i];
    if (!line) continue;
    const isChange = line.startsWith("+") || line.startsWith("-");

    if (isChange) {
      // Include context lines before this change
      const contextStart = Math.max(lastChangeIdx + contextLines + 1, i - contextLines);
      if (contextStart > lastChangeIdx + contextLines + 1 && result.length > 0) {
        result.push("...");
      }
      for (let j = contextStart; j < i; j++) {
        const contextLine = output[j];
        if (contextLine && !result.includes(contextLine)) {
          result.push(contextLine);
        }
      }
      result.push(line);
      lastChangeIdx = i;
    }
  }

  // Include trailing context
  const trailingEnd = Math.min(output.length, lastChangeIdx + contextLines + 1);
  for (let i = lastChangeIdx + 1; i < trailingEnd; i++) {
    const line = output[i];
    if (line) {
      result.push(line);
    }
  }

  return result.join("\n");
}
