import { describe, expect, it } from "vitest";
import { autoMergeAdditive } from "../auto-merge.js";

const BASE = {
  frontmatter: {
    version: "1.0",
    scope: "project" as const,
    metadata: { name: "base" },
    tools: {},
  },
  body: "# Base",
};

describe("autoMergeAdditive", () => {
  it("merges additive non-conflicting tool changes", () => {
    const result = autoMergeAdditive(BASE, [
      {
        actor: "alice",
        document: {
          ...BASE,
          frontmatter: {
            ...BASE.frontmatter,
            tools: {
              cursor: { alwaysApply: true },
            },
          },
        },
      },
      {
        actor: "bob",
        document: {
          ...BASE,
          frontmatter: {
            ...BASE.frontmatter,
            tools: {
              aider: { model: "o3" },
            },
          },
        },
      },
    ]);

    expect(result.autoMerged).toBe(true);
    expect(result.conflicts).toHaveLength(0);
    expect(result.merged.frontmatter.tools?.cursor).toBeDefined();
    expect(result.merged.frontmatter.tools?.aider).toBeDefined();
    expect(result.actors).toEqual(["alice", "bob"]);
  });

  it("does not auto-merge conflicting edits to same field", () => {
    const result = autoMergeAdditive(BASE, [
      {
        actor: "alice",
        document: {
          ...BASE,
          frontmatter: {
            ...BASE.frontmatter,
            tools: { cursor: { alwaysApply: true } },
          },
        },
      },
      {
        actor: "bob",
        document: {
          ...BASE,
          frontmatter: {
            ...BASE.frontmatter,
            tools: { cursor: { alwaysApply: false } },
          },
        },
      },
    ]);

    expect(result.autoMerged).toBe(false);
    expect(result.conflicts).toContain("tools.cursor.alwaysApply");
  });

  it("tracks source actors in merge result for audit", () => {
    const result = autoMergeAdditive(BASE, [
      { actor: "alice", document: BASE },
      { actor: "bob", document: BASE },
    ]);

    expect(result.actors).toEqual(["alice", "bob"]);
  });
});
