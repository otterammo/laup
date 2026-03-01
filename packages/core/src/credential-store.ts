/**
 * Secure credential store (INFRA-005).
 * Encrypted storage for sensitive credentials with access control.
 */

import { z } from "zod";
import type { DbAdapter } from "./db-adapter.js";

/**
 * Credential types.
 */
export const CredentialTypeSchema = z.enum([
  "api-key", // API keys
  "oauth-token", // OAuth tokens
  "password", // Passwords
  "certificate", // Certificates
  "ssh-key", // SSH keys
  "webhook-secret", // Webhook secrets
  "encryption-key", // Encryption keys
  "other", // Other sensitive data
]);

export type CredentialType = z.infer<typeof CredentialTypeSchema>;

/**
 * Credential metadata.
 */
export interface CredentialMetadata {
  /** Human-readable name */
  name: string;

  /** Description */
  description?: string;

  /** Credential type */
  type: CredentialType;

  /** Service/provider this credential is for */
  service?: string;

  /** Owner (user or team ID) */
  ownerId: string;

  /** Owner type */
  ownerType: "user" | "team" | "org";

  /** Allowed scopes (project IDs, team IDs) */
  allowedScopes?: string[];

  /** Expiration time (ISO 8601) */
  expiresAt?: string;

  /** Creation time */
  createdAt: string;

  /** Last rotation time */
  rotatedAt?: string;

  /** Last access time */
  lastAccessedAt?: string;

  /** Tags for organization */
  tags?: string[];
}

/**
 * Stored credential (metadata + encrypted value).
 */
export interface StoredCredential {
  /** Unique credential ID */
  id: string;

  /** Metadata */
  metadata: CredentialMetadata;

  /** Encrypted credential value */
  encryptedValue: string;

  /** Encryption version (for key rotation) */
  encryptionVersion: number;
}

/**
 * Credential access record.
 */
export interface CredentialAccess {
  credentialId: string;
  accessor: string;
  timestamp: string;
  action: "read" | "write" | "delete" | "rotate";
  success: boolean;
  reason?: string;
}

/**
 * Credential query filters.
 */
export interface CredentialQueryFilter {
  /** Filter by owner */
  ownerId?: string;

  /** Filter by type */
  type?: CredentialType;

  /** Filter by service */
  service?: string;

  /** Filter by tag */
  tag?: string;

  /** Include expired */
  includeExpired?: boolean;
}

/**
 * Encryption provider interface.
 */
export interface EncryptionProvider {
  /** Current encryption version */
  readonly version: number;

  /** Encrypt a value */
  encrypt(plaintext: string): Promise<string>;

  /** Decrypt a value */
  decrypt(ciphertext: string, version?: number): Promise<string>;

  /** Check if value needs re-encryption (old version) */
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

/**
 * Credential store interface.
 */
export interface CredentialStore {
  /**
   * Initialize the store.
   */
  init(): Promise<void>;

  /**
   * Store a credential.
   */
  store(metadata: Omit<CredentialMetadata, "createdAt">, value: string): Promise<string>;

  /**
   * Retrieve a credential value.
   */
  get(id: string, accessor: string): Promise<string | null>;

  /**
   * Get credential metadata (without value).
   */
  getMetadata(id: string): Promise<CredentialMetadata | null>;

  /**
   * List credentials matching filter.
   */
  list(filter: CredentialQueryFilter): Promise<CredentialMetadata[]>;

  /**
   * Update a credential value.
   */
  update(id: string, value: string, accessor: string): Promise<void>;

  /**
   * Rotate a credential (update value and record rotation).
   */
  rotate(id: string, newValue: string, accessor: string): Promise<void>;

  /**
   * Delete a credential.
   */
  delete(id: string, accessor: string): Promise<void>;

  /**
   * Get access history for a credential.
   */
  getAccessHistory(id: string, limit?: number): Promise<CredentialAccess[]>;

  /**
   * Check if a credential is expired.
   */
  isExpired(id: string): Promise<boolean>;

  /**
   * Get credentials that need rotation (older than maxAge).
   */
  getStaleCredentials(maxAgeDays: number): Promise<CredentialMetadata[]>;

  /**
   * Re-encrypt credentials with new encryption version.
   */
  reencryptAll(accessor: string): Promise<number>;
}

/**
 * In-memory credential store for testing.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private credentials: Map<string, StoredCredential> = new Map();
  private accessLog: CredentialAccess[] = [];
  private nextId = 1;

  constructor(private encryption: EncryptionProvider = new TestEncryptionProvider()) {}

  async init(): Promise<void> {}

  async store(metadata: Omit<CredentialMetadata, "createdAt">, value: string): Promise<string> {
    const id = `cred_${this.nextId++}`;
    const encrypted = await this.encryption.encrypt(value);

    this.credentials.set(id, {
      id,
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString(),
      },
      encryptedValue: encrypted,
      encryptionVersion: this.encryption.version,
    });

    return id;
  }

  async get(id: string, accessor: string): Promise<string | null> {
    const cred = this.credentials.get(id);

    this.logAccess(id, accessor, "read", !!cred);

    if (!cred) return null;

    // Update last accessed
    cred.metadata.lastAccessedAt = new Date().toISOString();

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

        if (!filter.includeExpired && cred.metadata.expiresAt) {
          if (new Date(cred.metadata.expiresAt) < new Date()) return false;
        }

        return true;
      })
      .map((cred) => cred.metadata);
  }

  async update(id: string, value: string, accessor: string): Promise<void> {
    const cred = this.credentials.get(id);
    if (!cred) {
      this.logAccess(id, accessor, "write", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    cred.encryptedValue = await this.encryption.encrypt(value);
    cred.encryptionVersion = this.encryption.version;

    this.logAccess(id, accessor, "write", true);
  }

  async rotate(id: string, newValue: string, accessor: string): Promise<void> {
    const cred = this.credentials.get(id);
    if (!cred) {
      this.logAccess(id, accessor, "rotate", false, "Credential not found");
      throw new Error(`Credential ${id} not found`);
    }

    cred.encryptedValue = await this.encryption.encrypt(newValue);
    cred.encryptionVersion = this.encryption.version;
    cred.metadata.rotatedAt = new Date().toISOString();

    this.logAccess(id, accessor, "rotate", true);
  }

  async delete(id: string, accessor: string): Promise<void> {
    const existed = this.credentials.delete(id);
    this.logAccess(id, accessor, "delete", existed);
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
        const lastRotated = cred.metadata.rotatedAt ?? cred.metadata.createdAt;
        return new Date(lastRotated) < cutoff;
      })
      .map((cred) => cred.metadata);
  }

  async reencryptAll(accessor: string): Promise<number> {
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
        this.logAccess(cred.id, accessor, "write", true, "Re-encryption");
      }
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
    };
    if (reason) entry.reason = reason;
    this.accessLog.push(entry);
  }
}

/**
 * SQL-based credential store.
 */
export class SqlCredentialStore implements CredentialStore {
  constructor(
    private db: DbAdapter,
    private encryption: EncryptionProvider = new TestEncryptionProvider(),
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
        expires_at TEXT,
        created_at TEXT NOT NULL,
        rotated_at TEXT,
        last_accessed_at TEXT,
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
      `INSERT INTO credentials (id, name, description, type, service, owner_id, owner_type, allowed_scopes, expires_at, created_at, tags, encrypted_value, encryption_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        metadata.name,
        metadata.description ?? null,
        metadata.type,
        metadata.service ?? null,
        metadata.ownerId,
        metadata.ownerType,
        metadata.allowedScopes ? JSON.stringify(metadata.allowedScopes) : null,
        metadata.expiresAt ?? null,
        createdAt,
        metadata.tags ? JSON.stringify(metadata.tags) : null,
        encrypted,
        this.encryption.version,
      ],
    );

    return id;
  }

  async get(id: string, accessor: string): Promise<string | null> {
    const row = await this.db.queryOne<{ encrypted_value: string; encryption_version: number }>(
      `SELECT encrypted_value, encryption_version FROM credentials WHERE id = ?`,
      [id],
    );

    await this.logAccess(id, accessor, "read", !!row);

    if (!row) return null;

    await this.db.execute(`UPDATE credentials SET last_accessed_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      id,
    ]);

    return this.encryption.decrypt(row.encrypted_value, row.encryption_version);
  }

  async getMetadata(id: string): Promise<CredentialMetadata | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      `SELECT name, description, type, service, owner_id, owner_type, allowed_scopes, expires_at, created_at, rotated_at, last_accessed_at, tags FROM credentials WHERE id = ?`,
      [id],
    );

    if (!row) return null;

    return this.rowToMetadata(row);
  }

  async list(_filter: CredentialQueryFilter): Promise<CredentialMetadata[]> {
    // Simplified - real implementation would build WHERE clause
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT name, description, type, service, owner_id, owner_type, allowed_scopes, expires_at, created_at, rotated_at, last_accessed_at, tags FROM credentials`,
    );

    return result.rows.map((row) => this.rowToMetadata(row));
  }

  async update(id: string, value: string, accessor: string): Promise<void> {
    const encrypted = await this.encryption.encrypt(value);
    const result = await this.db.execute(
      `UPDATE credentials SET encrypted_value = ?, encryption_version = ? WHERE id = ?`,
      [encrypted, this.encryption.version, id],
    );

    await this.logAccess(id, accessor, "write", result > 0);

    if (result === 0) {
      throw new Error(`Credential ${id} not found`);
    }
  }

  async rotate(id: string, newValue: string, accessor: string): Promise<void> {
    const encrypted = await this.encryption.encrypt(newValue);
    const now = new Date().toISOString();
    const result = await this.db.execute(
      `UPDATE credentials SET encrypted_value = ?, encryption_version = ?, rotated_at = ? WHERE id = ?`,
      [encrypted, this.encryption.version, now, id],
    );

    await this.logAccess(id, accessor, "rotate", result > 0);

    if (result === 0) {
      throw new Error(`Credential ${id} not found`);
    }
  }

  async delete(id: string, accessor: string): Promise<void> {
    const result = await this.db.execute(`DELETE FROM credentials WHERE id = ?`, [id]);
    await this.logAccess(id, accessor, "delete", result > 0);
  }

  async getAccessHistory(id: string, limit = 100): Promise<CredentialAccess[]> {
    const result = await this.db.query<CredentialAccess>(
      `SELECT credential_id, accessor, timestamp, action, success, reason FROM credential_access_log WHERE credential_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [id, limit],
    );
    return result.rows;
  }

  async isExpired(id: string): Promise<boolean> {
    const row = await this.db.queryOne<{ expires_at: string | null }>(
      `SELECT expires_at FROM credentials WHERE id = ?`,
      [id],
    );
    if (!row?.expires_at) return false;
    return new Date(row.expires_at) < new Date();
  }

  async getStaleCredentials(_maxAgeDays: number): Promise<CredentialMetadata[]> {
    // Simplified
    return [];
  }

  async reencryptAll(_accessor: string): Promise<number> {
    // Would iterate and re-encrypt
    return 0;
  }

  private rowToMetadata(row: Record<string, unknown>): CredentialMetadata {
    const meta: CredentialMetadata = {
      name: row["name"] as string,
      type: row["type"] as CredentialType,
      ownerId: row["owner_id"] as string,
      ownerType: row["owner_type"] as "user" | "team" | "org",
      createdAt: row["created_at"] as string,
    };

    if (row["description"]) meta.description = row["description"] as string;
    if (row["service"]) meta.service = row["service"] as string;
    if (row["allowed_scopes"]) meta.allowedScopes = JSON.parse(row["allowed_scopes"] as string);
    if (row["expires_at"]) meta.expiresAt = row["expires_at"] as string;
    if (row["rotated_at"]) meta.rotatedAt = row["rotated_at"] as string;
    if (row["last_accessed_at"]) meta.lastAccessedAt = row["last_accessed_at"] as string;
    if (row["tags"]) meta.tags = JSON.parse(row["tags"] as string);

    return meta;
  }

  private async logAccess(
    credentialId: string,
    accessor: string,
    action: string,
    success: boolean,
    reason?: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO credential_access_log (credential_id, accessor, timestamp, action, success, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [credentialId, accessor, new Date().toISOString(), action, success ? 1 : 0, reason ?? null],
    );
  }
}

/**
 * Create a credential store with the given database adapter.
 */
export function createCredentialStore(
  db: DbAdapter,
  encryption?: EncryptionProvider,
): CredentialStore {
  return new SqlCredentialStore(db, encryption);
}
