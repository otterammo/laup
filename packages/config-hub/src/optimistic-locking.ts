import type { CanonicalInstruction } from "@laup/core";

export interface VersionedDocument {
  id: string;
  scope: "project" | "team" | "org";
  document: CanonicalInstruction;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface UpdateRequest {
  id: string;
  expectedVersion: number;
  document: CanonicalInstruction;
  actor: string;
}

export interface ConflictError {
  code: "VERSION_CONFLICT";
  message: string;
  currentVersion: number;
}

export class VersionConflict extends Error {
  readonly currentVersion: number;

  constructor(currentVersion: number) {
    super(`Version conflict. Current version is ${currentVersion}`);
    this.name = "VersionConflict";
    this.currentVersion = currentVersion;
  }

  toResponse(): ConflictError {
    return {
      code: "VERSION_CONFLICT",
      message: this.message,
      currentVersion: this.currentVersion,
    };
  }
}

export class VersionedDocumentStore {
  private docs = new Map<string, VersionedDocument>();

  create(
    id: string,
    scope: VersionedDocument["scope"],
    document: CanonicalInstruction,
    actor: string,
  ): VersionedDocument {
    const created: VersionedDocument = {
      id,
      scope,
      document,
      version: 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
    this.docs.set(id, created);
    return created;
  }

  get(id: string): VersionedDocument | null {
    return this.docs.get(id) ?? null;
  }

  update(request: UpdateRequest): VersionedDocument {
    const current = this.docs.get(request.id);
    if (!current) {
      throw new Error(`Document not found: ${request.id}`);
    }

    if (current.version !== request.expectedVersion) {
      throw new VersionConflict(current.version);
    }

    const updated: VersionedDocument = {
      ...current,
      document: request.document,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: request.actor,
    };

    this.docs.set(request.id, updated);
    return updated;
  }
}
