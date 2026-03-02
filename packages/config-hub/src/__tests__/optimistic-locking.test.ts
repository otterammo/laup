import { describe, expect, it } from "vitest";
import { VersionConflict, VersionedDocumentStore } from "../optimistic-locking.js";

const DOC = {
  frontmatter: { version: "1.0", scope: "project" as const },
  body: "# Test",
};

describe("VersionedDocumentStore", () => {
  it("creates documents with version 1", () => {
    const store = new VersionedDocumentStore();
    const created = store.create("doc-1", "project", DOC, "alice");

    expect(created.version).toBe(1);
    expect(created.updatedBy).toBe("alice");
  });

  it("updates with matching expected version", () => {
    const store = new VersionedDocumentStore();
    store.create("doc-1", "project", DOC, "alice");

    const updated = store.update({
      id: "doc-1",
      expectedVersion: 1,
      actor: "bob",
      document: { ...DOC, body: "# Updated" },
    });

    expect(updated.version).toBe(2);
    expect(updated.updatedBy).toBe("bob");
    expect(updated.document.body).toContain("Updated");
  });

  it("rejects stale expected version with VersionConflict", () => {
    const store = new VersionedDocumentStore();
    store.create("doc-1", "project", DOC, "alice");
    store.update({
      id: "doc-1",
      expectedVersion: 1,
      actor: "bob",
      document: { ...DOC, body: "# Updated once" },
    });

    expect(() =>
      store.update({
        id: "doc-1",
        expectedVersion: 1,
        actor: "charlie",
        document: { ...DOC, body: "# stale write" },
      }),
    ).toThrow(VersionConflict);
  });

  it("conflict error includes current version for client retry", () => {
    const store = new VersionedDocumentStore();
    store.create("doc-1", "project", DOC, "alice");
    store.update({ id: "doc-1", expectedVersion: 1, actor: "bob", document: DOC });

    try {
      store.update({ id: "doc-1", expectedVersion: 1, actor: "charlie", document: DOC });
      throw new Error("expected conflict");
    } catch (err) {
      expect(err).toBeInstanceOf(VersionConflict);
      const conflict = err as VersionConflict;
      const response = conflict.toResponse();
      expect(response.code).toBe("VERSION_CONFLICT");
      expect(response.currentVersion).toBe(2);
    }
  });
});
