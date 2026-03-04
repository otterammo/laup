import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ScopeCrudError, ScopeDocumentStore } from "../crud.js";

const DOC = `---
version: "1.0"
scope: project
---

# Test
`;

describe("ScopeDocumentStore", () => {
  const roots: string[] = [];
  afterEach(() => {
    roots.forEach((r) => {
      rmSync(r, { recursive: true, force: true });
    });
  });

  function makeStore() {
    const root = mkdtempSync(join(tmpdir(), "laup-crud-"));
    roots.push(root);
    return new ScopeDocumentStore({
      projectPath: join(root, "laup.md"),
      orgPath: join(root, "org.md"),
      teamsDir: join(root, "teams"),
    });
  }

  it("creates/reads/updates/deletes", () => {
    const store = makeStore();
    store.create({ scope: "project" }, DOC);
    expect(store.read({ scope: "project" }).content).toContain("# Test");
    store.update({ scope: "project" }, DOC.replace("# Test", "# Updated"));
    expect(store.read({ scope: "project" }).content).toContain("# Updated");
    store.delete({ scope: "project" });
    expect(() => store.read({ scope: "project" })).toThrow(ScopeCrudError);
  });

  it("validates team scope-id", () => {
    const store = makeStore();
    expect(() => store.read({ scope: "team" })).toThrow(ScopeCrudError);
  });

  it("returns validation errors", () => {
    const store = makeStore();
    expect(() => store.create({ scope: "org" }, "---\n:bad\n---\n")).toThrow(ScopeCrudError);
  });
});
