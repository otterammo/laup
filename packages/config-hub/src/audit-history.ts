export type DocumentChangeAction = "create" | "update" | "delete";

export interface DocumentAuditRecord {
  id: string;
  action: DocumentChangeAction;
  actor: string;
  timestamp: string;
  scope: "project" | "team" | "org";
  documentId: string;
  diff: string;
}

export interface AuditQuery {
  documentId?: string;
  from?: string;
  to?: string;
}

export class DocumentAuditHistory {
  private readonly records: DocumentAuditRecord[] = [];

  append(record: Omit<DocumentAuditRecord, "id" | "timestamp">): DocumentAuditRecord {
    const created: DocumentAuditRecord = {
      ...record,
      id: `audit_${this.records.length + 1}`,
      timestamp: new Date().toISOString(),
    };

    this.records.push(created);
    return created;
  }

  query(filters: AuditQuery = {}): DocumentAuditRecord[] {
    const fromMs = filters.from ? new Date(filters.from).getTime() : null;
    const toMs = filters.to ? new Date(filters.to).getTime() : null;

    return this.records.filter((r) => {
      if (filters.documentId && r.documentId !== filters.documentId) return false;
      const t = new Date(r.timestamp).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      return true;
    });
  }

  all(): DocumentAuditRecord[] {
    return [...this.records];
  }
}
