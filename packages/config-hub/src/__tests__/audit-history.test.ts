import { describe, expect, it } from "vitest";
import { DocumentAuditHistory } from "../audit-history.js";

describe("DocumentAuditHistory", () => {
  it("records create/update/delete with actor, scope, doc id, diff", () => {
    const audit = new DocumentAuditHistory();

    const create = audit.append({
      action: "create",
      actor: "alice",
      scope: "project",
      documentId: "doc-1",
      diff: "+ # New Document",
    });

    const update = audit.append({
      action: "update",
      actor: "bob",
      scope: "project",
      documentId: "doc-1",
      diff: "- old\n+ new",
    });

    const del = audit.append({
      action: "delete",
      actor: "charlie",
      scope: "project",
      documentId: "doc-1",
      diff: "- full document",
    });

    expect(create.id).toBe("audit_1");
    expect(update.id).toBe("audit_2");
    expect(del.id).toBe("audit_3");
    expect(create.timestamp).toBeDefined();
  });

  it("is append-only", () => {
    const audit = new DocumentAuditHistory();
    audit.append({
      action: "create",
      actor: "alice",
      scope: "project",
      documentId: "doc-1",
      diff: "+ body",
    });

    const snapshot = audit.all();
    snapshot.length = 0;

    expect(audit.all()).toHaveLength(1);
  });

  it("queries by document id", () => {
    const audit = new DocumentAuditHistory();
    audit.append({
      action: "create",
      actor: "alice",
      scope: "project",
      documentId: "doc-1",
      diff: "+ body",
    });
    audit.append({
      action: "create",
      actor: "alice",
      scope: "project",
      documentId: "doc-2",
      diff: "+ body",
    });

    const rows = audit.query({ documentId: "doc-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.documentId).toBe("doc-1");
  });
});
