/**
 * Secure credential store (INFRA-005).
 * Encrypted storage for sensitive credentials with access control.
 */

import { z } from "zod";
import type { AuditStorage } from "./audit-storage.js";
import type { DbAdapter } from "./db-adapter.js";

/**
 * Credential types.
 */
export const CredentialTypeSchema = z.enum([
  "api-key",
  "oauth-token",
  "password",
  "certificate",
  "ssh-key",
  "webhook-secret",
  "encryption-key",
  "other",
]);

export type CredentialType = z.infer<typeof CredentialTypeSchema>;

export const SecretScopeKindSchema = z.enum(["global", "org", "team", "project", "user"]);
export type SecretScopeKind = z.infer<typeof SecretScopeKindSchema>;

export interface SecretScope {
  kind: SecretScopeKind;
  id?: string;
}

export interface CredentialAccessContext {
  accessorId: string;
  accessorType?: "user" | "service" | "agent";
  scopes?: string[];
}

export interface CredentialAccessPolicy {
  readers?: string[];
  writers?: string[];
  rotators?: string[];
  allowedAccessorTypes?: Array<"user" | "service" | "agent">;
  requiredScopes?: string[];
  allowOwnerAccess?: boolean;
}

/**
 * Credential metadata.
 */
export interface CredentialMetadata {
  name: string;
  description?: string;
  type: CredentialType;
  service?: string;
  ownerId: string;
  ownerType: "user" | "team" | "org";
  allowedScopes?: string[];
  scope?: SecretScope;
  expiresAt?: string;
  createdAt: string;
  rotatedAt?: string;
  lastAccessedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  tags?: string[];
  status?: "active" | "revoked";
  rotationPeriodDays?: number;
  policy?: CredentialAccessPolicy;
}

/**
 * Stored credential (metadata + encrypted value).
 */
export interface StoredCredential {
  id: string;
  metadata: CredentialMetadata;
  encryptedValue: string;
  encryptionVersion: number;
}

/**
 * Credential access record.
 */
export interface CredentialAccess {
  credentialId: string;
  accessor: string;
  timestamp: string;
  action: "read" | "write" | "delete" | "rotate" | "revoke" | "policy-update";
  success: boolean;
  reason?: string;
}

/**
 * Credential query filters.
 */
export interface CredentialQueryFilter {
  ownerId?: string;
  type?: CredentialType;
  service?: string;
  tag?: string;
  includeExpired?: boolean;
  includeRevoked?: boolean;
  scopeKind?: SecretScopeKind;
  scopeId?: string;
}

/**
 * Encryption provider interface.
 */
export interface EncryptionProvider {
  readonly version: number;
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string, version?: number): Promise<string>;
  needsReencryption(version: number): boolean;
}

/**
 * Simple base64 "encryption" for testing (NOT SECURE).
 */
export class TestEncryptionProvider implements EncryptionProvider {
  readonly version = 1;

  async encrypt(plaintext: string): Promise<string> {
    return Buffer.from(plaintext).toString("base64");
  }

  async decrypt(ciphertext: string, _version?: number): Promise<string> {
    return Buffer.from(ciphertext, "base64").toString("utf-8");
  }

  needsReencryption(_version: number): boolean {
    return false;
  }
}

export interface CredentialStore {
  init(): Promise<void>;
  store(metadata: Omit<CredentialMetadata, "createdAt">, value: string): Promise<string>;
  get(id: string, accessor: string | CredentialAccessContext): Promise<string | null>;
  getMetadata(id: string): Promise<CredentialMetadata | null>;
  list(filter: CredentialQueryFilter): Promise<CredentialMetadata[]>;
  update(id: string, value: string, accessor: string | CredentialAccessContext): Promise<void>;
  rotate(id: string, newValue: string, accessor: string | CredentialAccessContext): Promise<void>;
  revoke(id: string, accessor: string | CredentialAccessContext, reason?: string): Promise<void>;
  setAccessPolicy(
    id: string,
    policy: CredentialAccessPolicy,
    accessor: string | CredentialAccessContext,
  ): Promise<void>;
  delete(id: string, accessor: string | CredentialAccessContext): Promise<void>;
  getAccessHistory(id: string, limit?: number): Promise<CredentialAccess[]>;
  isExpired(id: string): Promise<boolean>;
  getStaleCredentials(maxAgeDays: number): Promise<CredentialMetadata[]>;
  reencryptAll(accessor: string | CredentialAccessContext): Promise<number>;
}

function normalizeAccessor(accessor: string | CredentialAccessContext): CredentialAccessContext {
  return typeof accessor === "string" ? { accessorId: accessor } : accessor;
}

function canAccess(
  metadata: CredentialMetadata,
  policy: CredentialAccessPolicy | undefined,
  action: "read" | "write" | "rotate" | "revoke",
  accessor: CredentialAccessContext,
): { allowed: boolean; reason?: string } {
  if (metadata.status === "revoked" && action !== "revoke") {
    return { allowed: false, reason: "Credential revoked" };
  }

  const ownerAllowed = policy?.allowOwnerAccess ?? true;
  if (ownerAllowed && accessor.accessorId === metadata.ownerId) {
    return { allowed: true };
  }

  if (policy?.allowedAccessorTypes?.length && accessor.accessorType) {
    if (!policy.allowedAccessorTypes.includes(accessor.accessorType)) {
      return { allowed: false, reason: "Accessor type denied" };
    }
  }

  if (policy?.requiredScopes?.length) {
    const scopes = new Set(accessor.scopes ?? []);
    const hasAllScopes = policy.requiredScopes.every((scope) => scopes.has(scope));
    if (!hasAllScopes) {
      return { allowed: false, reason: "Required scopes missing" };
    }
  }

  const acl =
    action === "read"
      ? policy?.readers
      : action === "write"
        ? policy?.writers
        : action === "rotate"
          ? policy?.rotators
          : policy?.rotators;

  if (acl?.length && !acl.includes(accessor.accessorId)) {
    return { allowed: false, reason: `Accessor not allowed for ${action}` };
  }

  if (metadata.allowedScopes?.length && accessor.scopes?.length) {
    const allowed = new Set(metadata.allowedScopes);
    const matches = accessor.scopes.some((scope) => allowed.has(scope));
    if (!matches) {
      return { allowed: false, reason: "Scope not allowed" };
    }
  }

  return { allowed: true };
}

export class InMemoryCredentialStore implements CredentialStore {
  private credentials: Map<string, StoredCredential> = new Map();
  private accessLog: CredentialAccess[] = [];
  private nextId = 1;

  constructor(
    private encryption: EncryptionProvider = new TestEncryptionProvider(),
    private auditStorage?: AuditStorage,
  ) {}

  async init(): Promise<void> {}

  async store(metadata: Omit<CredentialMetadata, "createdAt">, value: string): Promise<string> {
    const id = `cred_${this.nextId++}`;
    const encrypted = await this.encryption.encrypt(value);

    const normalizedMetadata: CredentialMetadata = {
      ...metadata,
      createdAt: new Date().toISOString(),
      status: metadata.status ?? "active",
    };

    this.credentials.set(id, {
      id,
      metadata: normalizedMetadata,
      encryptedValue: encrypted,
      encryptionVersion: this.encryption.version,
    });

    await this.audit("credential.create", normalizedMetadata.ownerId, id, "info", {
      ownerId: normalizedMetadata.ownerId,
      type: normalizedMetadata.type,
      scope: normalizedMetadata.scope,
    });

    return id;
  }

  async get(id: string, accessor: string | CredentialAccessContext): Promise<string | null> {
    const access = normalizeAccessor(accessor);
    const cred = this.credentials.get(id);

    if (!cred) {
      this.logAccess(id, access.accessorId, "read", false, "Credential not found");
      return null;
    }

    const decision = canAccess(cred.metadata, cred.metadata.policy, "read", access);
    this.logAccess(id, access.accessorId, "read", decision.allowed, decision.reason);
    if (!decision.allowed) {
      await this.audit("credential.read.denied", access.accessorId, id, "warning", {
        reason: decision.reason,
      });
      return null;
    }

    cred.metadata.lastAccessedAt = new Date().toISOString();
    await this.audit("credential.read", access.accessorId, id, "info");
    return this.encryption.decrypt(cred.encryptedValue, cred.encryptionVersion);
  }

  async getMetadata(id: string): Promise<CredentialMetadata | null> {
    const cred = this.credentials.get(id);
    return cred?.metadata ?? null;
  }

  async list(filter: CredentialQueryFilter): Promise<CredentialMetadata[]> {
    return Array.from(this.credentials.values())
      .filter((cred) => {
        if (filter.ownerId && cred.metadata.ownerId !== filter.ownerId) return false;
        if (filter.type && cred.metadata.type !== filter.type) return false;
        if (filter.service && cred.metadata.service !== filter.service) return false;
        if (filter.tag && !cred.metadata.tags?.includes(filter.tag)) return false;
        if (!filter.includeRevoked && cred.metadata.status === "revoked") return false;
        if (filter.scopeKind && cred.metadata.scope?.kind !== filter.scopeKind) return false;
        if (filter.scopeId && cred.metadata.scope?.id !== filter.scopeId) return false;
        if (!filter.includeExpired && cred.metadata.expiresAt) {
          if (new Date(cred.metadata.expiresAt) < new Date()) return false;
        }
        return true;
      })
      .map((cred) => cred.metadata);
  }

  async update(
    id: string,
    value: string,
    accessor: string | CredentialAccessContext,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const cred = this.credentials.get(id);
    if (!cred) {
      this.logAccess(id, access.accessorId, "write", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    const decision = canAccess(cred.metadata, cred.metadata.policy, "write", access);
    if (!decision.allowed) {
      this.logAccess(id, access.accessorId, "write", false, decision.reason);
      throw new Error(decision.reason ?? "Access denied");
    }

    cred.encryptedValue = await this.encryption.encrypt(value);
    cred.encryptionVersion = this.encryption.version;
    this.logAccess(id, access.accessorId, "write", true);
    await this.audit("credential.update", access.accessorId, id, "info");
  }

  async rotate(
    id: string,
    newValue: string,
    accessor: string | CredentialAccessContext,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const cred = this.credentials.get(id);
    if (!cred) {
      this.logAccess(id, access.accessorId, "rotate", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    const decision = canAccess(cred.metadata, cred.metadata.policy, "rotate", access);
    if (!decision.allowed) {
      this.logAccess(id, access.accessorId, "rotate", false, decision.reason);
      throw new Error(decision.reason ?? "Access denied");
    }

    cred.encryptedValue = await this.encryption.encrypt(newValue);
    cred.encryptionVersion = this.encryption.version;
    cred.metadata.rotatedAt = new Date().toISOString();
    cred.metadata.status = "active";

    this.logAccess(id, access.accessorId, "rotate", true);
    await this.audit("credential.rotate", access.accessorId, id, "info");
  }

  async revoke(
    id: string,
    accessor: string | CredentialAccessContext,
    reason?: string,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const cred = this.credentials.get(id);
    if (!cred) {
      this.logAccess(id, access.accessorId, "revoke", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    const decision = canAccess(cred.metadata, cred.metadata.policy, "revoke", access);
    if (!decision.allowed) {
      this.logAccess(id, access.accessorId, "revoke", false, decision.reason);
      throw new Error(decision.reason ?? "Access denied");
    }

    cred.metadata.status = "revoked";
    cred.metadata.revokedAt = new Date().toISOString();
    cred.metadata.revokedBy = access.accessorId;

    this.logAccess(id, access.accessorId, "revoke", true, reason);
    await this.audit("credential.revoke", access.accessorId, id, "warning", { reason });
  }

  async setAccessPolicy(
    id: string,
    policy: CredentialAccessPolicy,
    accessor: string | CredentialAccessContext,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const cred = this.credentials.get(id);
    if (!cred) {
      this.logAccess(id, access.accessorId, "policy-update", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    if (access.accessorId !== cred.metadata.ownerId) {
      this.logAccess(id, access.accessorId, "policy-update", false, "Only owner can update policy");
      throw new Error("Only owner can update access policy");
    }

    cred.metadata.policy = policy;
    this.logAccess(id, access.accessorId, "policy-update", true);
    await this.audit("credential.policy.update", access.accessorId, id, "info", { policy });
  }

  async delete(id: string, accessor: string | CredentialAccessContext): Promise<void> {
    const access = normalizeAccessor(accessor);
    const existed = this.credentials.delete(id);
    this.logAccess(id, access.accessorId, "delete", existed);
    if (existed) {
      await this.audit("credential.delete", access.accessorId, id, "warning");
    }
  }

  async getAccessHistory(id: string, limit = 100): Promise<CredentialAccess[]> {
    return this.accessLog.filter((log) => log.credentialId === id).slice(-limit);
  }

  async isExpired(id: string): Promise<boolean> {
    const cred = this.credentials.get(id);
    if (!cred?.metadata.expiresAt) return false;
    return new Date(cred.metadata.expiresAt) < new Date();
  }

  async getStaleCredentials(maxAgeDays: number): Promise<CredentialMetadata[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    return Array.from(this.credentials.values())
      .filter((cred) => {
        if (cred.metadata.status === "revoked") return false;

        const lastRotated = cred.metadata.rotatedAt ?? cred.metadata.createdAt;
        if (new Date(lastRotated) < cutoff) return true;

        const rotationPeriodDays = cred.metadata.rotationPeriodDays;
        if (rotationPeriodDays) {
          const staleByPolicy = new Date(lastRotated);
          staleByPolicy.setDate(staleByPolicy.getDate() + rotationPeriodDays);
          return staleByPolicy < new Date();
        }

        return false;
      })
      .map((cred) => cred.metadata);
  }

  async reencryptAll(accessor: string | CredentialAccessContext): Promise<number> {
    const access = normalizeAccessor(accessor);
    let count = 0;

    for (const cred of this.credentials.values()) {
      if (this.encryption.needsReencryption(cred.encryptionVersion)) {
        const plaintext = await this.encryption.decrypt(
          cred.encryptedValue,
          cred.encryptionVersion,
        );
        cred.encryptedValue = await this.encryption.encrypt(plaintext);
        cred.encryptionVersion = this.encryption.version;
        count++;
        this.logAccess(cred.id, access.accessorId, "write", true, "Re-encryption");
      }
    }

    if (count > 0) {
      await this.audit("credential.reencrypt", access.accessorId, "*", "info", { count });
    }

    return count;
  }

  private logAccess(
    credentialId: string,
    accessor: string,
    action: CredentialAccess["action"],
    success: boolean,
    reason?: string,
  ): void {
    const entry: CredentialAccess = {
      credentialId,
      accessor,
      timestamp: new Date().toISOString(),
      action,
      success,
      ...(reason ? { reason } : {}),
    };
    this.accessLog.push(entry);
  }

  private async audit(
    action: string,
    actor: string,
    targetId: string,
    severity: "info" | "warning" | "critical",
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditStorage) return;

    await this.auditStorage.append({
      category: "security",
      action,
      actor,
      targetId,
      targetType: "credential",
      severity,
      ...(metadata ? { metadata } : {}),
    });
  }
}

/**
 * SQL-based credential store.
 */
export class SqlCredentialStore implements CredentialStore {
  constructor(
    private db: DbAdapter,
    private encryption: EncryptionProvider = new TestEncryptionProvider(),
    private auditStorage?: AuditStorage,
  ) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        service TEXT,
        owner_id TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        allowed_scopes TEXT,
        scope_kind TEXT,
        scope_id TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        rotated_at TEXT,
        last_accessed_at TEXT,
        revoked_at TEXT,
        revoked_by TEXT,
        status TEXT,
        rotation_period_days INTEGER,
        access_policy TEXT,
        tags TEXT,
        encrypted_value TEXT NOT NULL,
        encryption_version INTEGER NOT NULL
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS credential_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id TEXT NOT NULL,
        accessor TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        success INTEGER NOT NULL,
        reason TEXT
      )
    `);

    await this.db.execute(`CREATE INDEX IF NOT EXISTS idx_cred_owner ON credentials(owner_id)`);
    await this.db.execute(
      `CREATE INDEX IF NOT EXISTS idx_cred_access_log ON credential_access_log(credential_id)`,
    );
  }

  async store(metadata: Omit<CredentialMetadata, "createdAt">, value: string): Promise<string> {
    const id = `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const encrypted = await this.encryption.encrypt(value);
    const createdAt = new Date().toISOString();

    await this.db.execute(
      `INSERT INTO credentials (id, name, description, type, service, owner_id, owner_type, allowed_scopes, scope_kind, scope_id, expires_at, created_at, rotated_at, last_accessed_at, revoked_at, revoked_by, status, rotation_period_days, access_policy, tags, encrypted_value, encryption_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        metadata.name,
        metadata.description ?? null,
        metadata.type,
        metadata.service ?? null,
        metadata.ownerId,
        metadata.ownerType,
        metadata.allowedScopes ? JSON.stringify(metadata.allowedScopes) : null,
        metadata.scope?.kind ?? null,
        metadata.scope?.id ?? null,
        metadata.expiresAt ?? null,
        createdAt,
        metadata.rotatedAt ?? null,
        metadata.lastAccessedAt ?? null,
        metadata.revokedAt ?? null,
        metadata.revokedBy ?? null,
        metadata.status ?? "active",
        metadata.rotationPeriodDays ?? null,
        metadata.policy ? JSON.stringify(metadata.policy) : null,
        metadata.tags ? JSON.stringify(metadata.tags) : null,
        encrypted,
        this.encryption.version,
      ],
    );

    await this.audit("credential.create", metadata.ownerId, id, "info");
    return id;
  }

  async get(id: string, accessor: string | CredentialAccessContext): Promise<string | null> {
    const access = normalizeAccessor(accessor);
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT encrypted_value, encryption_version, owner_id, owner_type, allowed_scopes, scope_kind, scope_id, status, access_policy, expires_at FROM credentials WHERE id = ?`,
      [id],
    );

    if (!row) {
      await this.logAccess(id, access.accessorId, "read", false, "Credential not found");
      return null;
    }

    const metadata = this.rowToMetadata(row);
    const decision = canAccess(metadata, metadata.policy, "read", access);
    await this.logAccess(id, access.accessorId, "read", decision.allowed, decision.reason);
    if (!decision.allowed) {
      await this.audit("credential.read.denied", access.accessorId, id, "warning", {
        reason: decision.reason,
      });
      return null;
    }

    await this.db.execute(`UPDATE credentials SET last_accessed_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      id,
    ]);

    await this.audit("credential.read", access.accessorId, id, "info");
    return this.encryption.decrypt(
      row["encrypted_value"] as string,
      row["encryption_version"] as number,
    );
  }

  async getMetadata(id: string): Promise<CredentialMetadata | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT name, description, type, service, owner_id, owner_type, allowed_scopes, scope_kind, scope_id, expires_at, created_at, rotated_at, last_accessed_at, revoked_at, revoked_by, status, rotation_period_days, access_policy, tags FROM credentials WHERE id = ?`,
      [id],
    );

    if (!row) return null;
    return this.rowToMetadata(row);
  }

  async list(filter: CredentialQueryFilter): Promise<CredentialMetadata[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT name, description, type, service, owner_id, owner_type, allowed_scopes, scope_kind, scope_id, expires_at, created_at, rotated_at, last_accessed_at, revoked_at, revoked_by, status, rotation_period_days, access_policy, tags FROM credentials`,
    );

    const all = result.rows.map((row) => this.rowToMetadata(row));
    return all.filter((meta) => {
      if (filter.ownerId && meta.ownerId !== filter.ownerId) return false;
      if (filter.type && meta.type !== filter.type) return false;
      if (filter.service && meta.service !== filter.service) return false;
      if (filter.tag && !meta.tags?.includes(filter.tag)) return false;
      if (!filter.includeExpired && meta.expiresAt && new Date(meta.expiresAt) < new Date())
        return false;
      if (!filter.includeRevoked && meta.status === "revoked") return false;
      if (filter.scopeKind && meta.scope?.kind !== filter.scopeKind) return false;
      if (filter.scopeId && meta.scope?.id !== filter.scopeId) return false;
      return true;
    });
  }

  async update(
    id: string,
    value: string,
    accessor: string | CredentialAccessContext,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const meta = await this.getMetadata(id);
    if (!meta) {
      await this.logAccess(id, access.accessorId, "write", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    const decision = canAccess(meta, meta.policy, "write", access);
    if (!decision.allowed) {
      await this.logAccess(id, access.accessorId, "write", false, decision.reason);
      throw new Error(decision.reason ?? "Access denied");
    }

    const encrypted = await this.encryption.encrypt(value);
    await this.db.execute(
      `UPDATE credentials SET encrypted_value = ?, encryption_version = ? WHERE id = ?`,
      [encrypted, this.encryption.version, id],
    );
    await this.logAccess(id, access.accessorId, "write", true);
    await this.audit("credential.update", access.accessorId, id, "info");
  }

  async rotate(
    id: string,
    newValue: string,
    accessor: string | CredentialAccessContext,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const meta = await this.getMetadata(id);
    if (!meta) {
      await this.logAccess(id, access.accessorId, "rotate", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    const decision = canAccess(meta, meta.policy, "rotate", access);
    if (!decision.allowed) {
      await this.logAccess(id, access.accessorId, "rotate", false, decision.reason);
      throw new Error(decision.reason ?? "Access denied");
    }

    const encrypted = await this.encryption.encrypt(newValue);
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE credentials SET encrypted_value = ?, encryption_version = ?, rotated_at = ?, status = 'active' WHERE id = ?`,
      [encrypted, this.encryption.version, now, id],
    );
    await this.logAccess(id, access.accessorId, "rotate", true);
    await this.audit("credential.rotate", access.accessorId, id, "info");
  }

  async revoke(
    id: string,
    accessor: string | CredentialAccessContext,
    reason?: string,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const meta = await this.getMetadata(id);
    if (!meta) {
      await this.logAccess(id, access.accessorId, "revoke", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    const decision = canAccess(meta, meta.policy, "revoke", access);
    if (!decision.allowed) {
      await this.logAccess(id, access.accessorId, "revoke", false, decision.reason);
      throw new Error(decision.reason ?? "Access denied");
    }

    await this.db.execute(
      `UPDATE credentials SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ?`,
      [new Date().toISOString(), access.accessorId, id],
    );
    await this.logAccess(id, access.accessorId, "revoke", true, reason);
    await this.audit("credential.revoke", access.accessorId, id, "warning", { reason });
  }

  async setAccessPolicy(
    id: string,
    policy: CredentialAccessPolicy,
    accessor: string | CredentialAccessContext,
  ): Promise<void> {
    const access = normalizeAccessor(accessor);
    const meta = await this.getMetadata(id);
    if (!meta) {
      await this.logAccess(id, access.accessorId, "policy-update", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    if (access.accessorId !== meta.ownerId) {
      await this.logAccess(
        id,
        access.accessorId,
        "policy-update",
        false,
        "Only owner can update policy",
      );
      throw new Error("Only owner can update access policy");
    }

    await this.db.execute(`UPDATE credentials SET access_policy = ? WHERE id = ?`, [
      JSON.stringify(policy),
      id,
    ]);
    await this.logAccess(id, access.accessorId, "policy-update", true);
    await this.audit("credential.policy.update", access.accessorId, id, "info", { policy });
  }

  async delete(id: string, accessor: string | CredentialAccessContext): Promise<void> {
    const access = normalizeAccessor(accessor);
    const result = await this.db.execute(`DELETE FROM credentials WHERE id = ?`, [id]);
    await this.logAccess(id, access.accessorId, "delete", result > 0);
    if (result > 0) {
      await this.audit("credential.delete", access.accessorId, id, "warning");
    }
  }

  async getAccessHistory(id: string, limit = 100): Promise<CredentialAccess[]> {
    const result = await this.db.query<{
      credential_id: string;
      accessor: string;
      timestamp: string;
      action: CredentialAccess["action"];
      success: number | boolean;
      reason: string | null;
    }>(
      `SELECT credential_id, accessor, timestamp, action, success, reason FROM credential_access_log WHERE credential_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [id, limit],
    );

    return result.rows.map((row) => ({
      credentialId: row.credential_id,
      accessor: row.accessor,
      timestamp: row.timestamp,
      action: row.action,
      success: Boolean(row.success),
      ...(row.reason ? { reason: row.reason } : {}),
    }));
  }

  async isExpired(id: string): Promise<boolean> {
    const row = await this.db.queryOne<{ expires_at: string | null }>(
      `SELECT expires_at FROM credentials WHERE id = ?`,
      [id],
    );
    if (!row?.expires_at) return false;
    return new Date(row.expires_at) < new Date();
  }

  async getStaleCredentials(maxAgeDays: number): Promise<CredentialMetadata[]> {
    const all = await this.list({ includeExpired: true, includeRevoked: false });
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);

    return all.filter((meta) => {
      const lastRotated = meta.rotatedAt ?? meta.createdAt;
      if (new Date(lastRotated) < cutoff) return true;

      const rotationPeriodDays = meta.rotationPeriodDays;
      if (rotationPeriodDays) {
        const staleByPolicy = new Date(lastRotated);
        staleByPolicy.setDate(staleByPolicy.getDate() + rotationPeriodDays);
        return staleByPolicy < new Date();
      }

      return false;
    });
  }

  async reencryptAll(accessor: string | CredentialAccessContext): Promise<number> {
    const access = normalizeAccessor(accessor);
    const rows = await this.db.query<{
      id: string;
      encrypted_value: string;
      encryption_version: number;
    }>(`SELECT id, encrypted_value, encryption_version FROM credentials`);

    let count = 0;
    for (const row of rows.rows) {
      if (!this.encryption.needsReencryption(row.encryption_version)) continue;

      const plaintext = await this.encryption.decrypt(row.encrypted_value, row.encryption_version);
      const encrypted = await this.encryption.encrypt(plaintext);
      await this.db.execute(
        `UPDATE credentials SET encrypted_value = ?, encryption_version = ? WHERE id = ?`,
        [encrypted, this.encryption.version, row.id],
      );
      count++;
      await this.logAccess(row.id, access.accessorId, "write", true, "Re-encryption");
    }

    if (count > 0) {
      await this.audit("credential.reencrypt", access.accessorId, "*", "info", { count });
    }

    return count;
  }

  private rowToMetadata(row: Record<string, unknown>): CredentialMetadata {
    const scopeKind = row["scope_kind"] as SecretScopeKind | null | undefined;
    const scopeId = row["scope_id"] as string | null | undefined;

    const metadata: CredentialMetadata = {
      name: (row["name"] as string) ?? "",
      type: (row["type"] as CredentialType) ?? "other",
      ownerId: (row["owner_id"] as string) ?? "",
      ownerType: (row["owner_type"] as "user" | "team" | "org") ?? "user",
      createdAt: (row["created_at"] as string) ?? new Date().toISOString(),
      ...(scopeKind
        ? { scope: scopeId ? { kind: scopeKind, id: scopeId } : { kind: scopeKind } }
        : {}),
      ...(row["status"] ? { status: row["status"] as "active" | "revoked" } : {}),
    };

    if (row["description"]) metadata.description = row["description"] as string;
    if (row["service"]) metadata.service = row["service"] as string;
    if (row["allowed_scopes"])
      metadata.allowedScopes = JSON.parse(row["allowed_scopes"] as string) as string[];
    if (row["expires_at"]) metadata.expiresAt = row["expires_at"] as string;
    if (row["rotated_at"]) metadata.rotatedAt = row["rotated_at"] as string;
    if (row["last_accessed_at"]) metadata.lastAccessedAt = row["last_accessed_at"] as string;
    if (row["revoked_at"]) metadata.revokedAt = row["revoked_at"] as string;
    if (row["revoked_by"]) metadata.revokedBy = row["revoked_by"] as string;
    if (row["rotation_period_days"])
      metadata.rotationPeriodDays = Number(row["rotation_period_days"]);
    if (row["access_policy"])
      metadata.policy = JSON.parse(row["access_policy"] as string) as CredentialAccessPolicy;
    if (row["tags"]) metadata.tags = JSON.parse(row["tags"] as string) as string[];

    return metadata;
  }

  private async logAccess(
    credentialId: string,
    accessor: string,
    action: CredentialAccess["action"],
    success: boolean,
    reason?: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO credential_access_log (credential_id, accessor, timestamp, action, success, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [credentialId, accessor, new Date().toISOString(), action, success ? 1 : 0, reason ?? null],
    );
  }

  private async audit(
    action: string,
    actor: string,
    targetId: string,
    severity: "info" | "warning" | "critical",
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditStorage) return;

    await this.auditStorage.append({
      category: "security",
      action,
      actor,
      targetId,
      targetType: "credential",
      severity,
      ...(metadata ? { metadata } : {}),
    });
  }
}

export function createCredentialStore(
  db: DbAdapter,
  encryption?: EncryptionProvider,
  auditStorage?: AuditStorage,
): CredentialStore {
  return new SqlCredentialStore(db, encryption, auditStorage);
}
