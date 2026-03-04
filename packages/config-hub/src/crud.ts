import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type CanonicalInstruction, getDefaultScopePath, parseCanonicalString } from "@laup/core";

export type ConfigScope = "org" | "team" | "project";
export interface ScopeRef {
  scope: ConfigScope;
  scopeId?: string;
}
export interface ScopeCrudOptions {
  projectPath?: string;
  orgPath?: string;
  teamsDir?: string;
}
export interface ScopeDocument {
  scope: ConfigScope;
  scopeId?: string;
  path: string;
  content: string;
  document: CanonicalInstruction;
}
export type CrudErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "VALIDATION_ERROR"
  | "INVALID_SCOPE"
  | "INVALID_REQUEST";

export class ScopeCrudError extends Error {
  constructor(
    public readonly code: CrudErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ScopeCrudError";
  }
}

export class ScopeDocumentStore {
  constructor(private readonly options: ScopeCrudOptions = {}) {}

  create(ref: ScopeRef, content: string): ScopeDocument {
    const path = this.resolvePath(ref);
    if (existsSync(path))
      throw new ScopeCrudError("ALREADY_EXISTS", `Document already exists at ${path}`, 409, {
        path,
      });
    const document = this.parse(content, path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return { ...ref, path, content, document };
  }

  read(ref: ScopeRef): ScopeDocument {
    const path = this.resolvePath(ref);
    if (!existsSync(path))
      throw new ScopeCrudError("NOT_FOUND", `Document not found at ${path}`, 404, { path });
    const content = readFileSync(path, "utf-8");
    return { ...ref, path, content, document: this.parse(content, path) };
  }

  update(ref: ScopeRef, content: string): ScopeDocument {
    const path = this.resolvePath(ref);
    if (!existsSync(path))
      throw new ScopeCrudError("NOT_FOUND", `Document not found at ${path}`, 404, { path });
    const document = this.parse(content, path);
    writeFileSync(path, content, "utf-8");
    return { ...ref, path, content, document };
  }

  delete(ref: ScopeRef): { scope: ConfigScope; scopeId?: string; path: string } {
    const path = this.resolvePath(ref);
    if (!existsSync(path))
      throw new ScopeCrudError("NOT_FOUND", `Document not found at ${path}`, 404, { path });
    rmSync(path);
    return { ...ref, path };
  }

  private parse(content: string, path: string): CanonicalInstruction {
    try {
      return parseCanonicalString(content);
    } catch (error) {
      const err = error as { message?: string; issues?: unknown };
      throw new ScopeCrudError("VALIDATION_ERROR", `Invalid canonical document at ${path}`, 400, {
        path,
        issues: err.issues ?? [{ message: err.message ?? String(error) }],
      });
    }
  }

  private resolvePath(ref: ScopeRef): string {
    switch (ref.scope) {
      case "org":
        return resolve(this.options.orgPath ?? getDefaultScopePath("org"));
      case "team": {
        if (!ref.scopeId)
          throw new ScopeCrudError("INVALID_REQUEST", "team scope requires scopeId", 400);
        return resolve(
          this.options.teamsDir
            ? `${this.options.teamsDir}/${ref.scopeId}.md`
            : getDefaultScopePath("team", ref.scopeId),
        );
      }
      case "project":
        return resolve(this.options.projectPath ?? getDefaultScopePath("project"));
      default:
        throw new ScopeCrudError(
          "INVALID_SCOPE",
          `Unsupported scope: ${(ref as ScopeRef).scope}`,
          400,
        );
    }
  }
}
