import type {
  McpAuditEntry,
  McpAuditOperation,
  McpCredentialRef,
  McpScope,
  McpServer,
} from "./mcp-schema.js";
import { validateMcpServer } from "./mcp-schema.js";

export interface McpRegistryOperationOptions {
  actor: string;
  reason?: string;
}

export interface McpRegistryQuery {
  serverId?: string;
  actor?: string;
  operation?: McpAuditOperation;
  scope?: McpScope;
  startTime?: string;
  endTime?: string;
}

export interface McpServerRegistry {
  init(): Promise<void>;
  register(server: McpServer, options: McpRegistryOperationOptions): Promise<void>;
  update(server: McpServer, options: McpRegistryOperationOptions): Promise<void>;
  deregister(
    serverId: string,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void>;
  enable(
    serverId: string,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void>;
  disable(
    serverId: string,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void>;
  rotateCredentials(
    serverId: string,
    credentials: McpCredentialRef,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void>;
  list(): Promise<McpServer[]>;
  get(serverId: string, scope?: McpScope, scopeId?: string): Promise<McpServer | null>;
  queryAudit(filter?: McpRegistryQuery): Promise<McpAuditEntry[]>;
}

function registryKey(serverId: string, scope?: McpScope, scopeId?: string): string {
  return `${scope ?? "project"}:${scopeId ?? ""}:${serverId}`;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryMcpServerRegistry implements McpServerRegistry {
  private readonly servers = new Map<string, McpServer>();
  private readonly auditLog: McpAuditEntry[] = [];
  private nextAuditId = 1;

  async init(): Promise<void> {}

  async register(server: McpServer, options: McpRegistryOperationOptions): Promise<void> {
    const validated = this.validate(server);
    const key = registryKey(validated.id, validated.scope, validated.scopeId);

    if (this.servers.has(key)) {
      throw new Error(`MCP server ${validated.id} already registered for scope ${validated.scope}`);
    }

    const now = new Date().toISOString();
    const nextServer: McpServer = {
      ...deepClone(validated),
      registeredAt: validated.registeredAt ?? now,
      updatedAt: now,
    };

    this.servers.set(key, nextServer);
    this.recordAudit({
      serverId: nextServer.id,
      scope: nextServer.scope,
      scopeId: nextServer.scopeId,
      operation: "register",
      actor: options.actor,
      reason: options.reason,
      newState: nextServer,
    });
  }

  async update(server: McpServer, options: McpRegistryOperationOptions): Promise<void> {
    const validated = this.validate(server);
    const key = registryKey(validated.id, validated.scope, validated.scopeId);
    const previous = this.servers.get(key);

    if (!previous) {
      throw new Error(`MCP server ${validated.id} not found`);
    }

    const nextServer: McpServer = {
      ...deepClone(validated),
      registeredAt: previous.registeredAt,
      updatedAt: new Date().toISOString(),
    };

    this.servers.set(key, nextServer);
    this.recordAudit({
      serverId: nextServer.id,
      scope: nextServer.scope,
      scopeId: nextServer.scopeId,
      operation: "update",
      actor: options.actor,
      reason: options.reason,
      previousState: previous,
      newState: nextServer,
    });
  }

  async deregister(
    serverId: string,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void> {
    const key = registryKey(serverId, scope, scopeId);
    const previous = this.servers.get(key);
    if (!previous) return;

    this.servers.delete(key);
    this.recordAudit({
      serverId,
      scope: previous.scope,
      scopeId: previous.scopeId,
      operation: "deregister",
      actor: options.actor,
      reason: options.reason,
      previousState: previous,
    });
  }

  async enable(
    serverId: string,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void> {
    await this.setEnabled(serverId, true, options, scope, scopeId);
  }

  async disable(
    serverId: string,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void> {
    await this.setEnabled(serverId, false, options, scope, scopeId);
  }

  async rotateCredentials(
    serverId: string,
    credentials: McpCredentialRef,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void> {
    const { key, previous } = this.requireServer(serverId, scope, scopeId);
    const nextServer: McpServer = {
      ...previous,
      credentials: deepClone(credentials),
      updatedAt: new Date().toISOString(),
    };

    this.servers.set(key, nextServer);
    this.recordAudit({
      serverId,
      scope: nextServer.scope,
      scopeId: nextServer.scopeId,
      operation: "credential-rotate",
      actor: options.actor,
      reason: options.reason,
      previousState: previous,
      newState: nextServer,
    });
  }

  async list(): Promise<McpServer[]> {
    return Array.from(this.servers.values()).map((server) => deepClone(server));
  }

  async get(serverId: string, scope?: McpScope, scopeId?: string): Promise<McpServer | null> {
    const server = this.servers.get(registryKey(serverId, scope, scopeId));
    return server ? deepClone(server) : null;
  }

  async queryAudit(filter?: McpRegistryQuery): Promise<McpAuditEntry[]> {
    const start = filter?.startTime ? Date.parse(filter.startTime) : undefined;
    const end = filter?.endTime ? Date.parse(filter.endTime) : undefined;

    return this.auditLog
      .filter((entry) => {
        if (filter?.serverId && entry.serverId !== filter.serverId) return false;
        if (filter?.actor && entry.actor !== filter.actor) return false;
        if (filter?.operation && entry.operation !== filter.operation) return false;
        if (filter?.scope && entry.scope !== filter.scope) return false;

        const timestamp = Date.parse(entry.timestamp);
        if (start !== undefined && !Number.isNaN(start) && timestamp < start) return false;
        if (end !== undefined && !Number.isNaN(end) && timestamp > end) return false;

        return true;
      })
      .map((entry) => deepClone(entry));
  }

  private validate(server: McpServer): McpServer {
    const result = validateMcpServer(server);
    if (!result.valid || !result.server) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    }
    return result.server;
  }

  private async setEnabled(
    serverId: string,
    enabled: boolean,
    options: McpRegistryOperationOptions,
    scope?: McpScope,
    scopeId?: string,
  ): Promise<void> {
    const { key, previous } = this.requireServer(serverId, scope, scopeId);
    const nextServer: McpServer = {
      ...previous,
      enabled,
      updatedAt: new Date().toISOString(),
    };

    this.servers.set(key, nextServer);
    this.recordAudit({
      serverId,
      scope: nextServer.scope,
      scopeId: nextServer.scopeId,
      operation: enabled ? "enable" : "disable",
      actor: options.actor,
      reason: options.reason,
      previousState: previous,
      newState: nextServer,
    });
  }

  private requireServer(serverId: string, scope?: McpScope, scopeId?: string) {
    const key = registryKey(serverId, scope, scopeId);
    const previous = this.servers.get(key);
    if (!previous) {
      throw new Error(`MCP server ${serverId} not found`);
    }
    return { key, previous };
  }

  private recordAudit(input: Omit<McpAuditEntry, "id" | "timestamp">): void {
    const entry: McpAuditEntry = Object.freeze({
      id: `mcp_audit_${this.nextAuditId++}`,
      timestamp: new Date().toISOString(),
      ...deepClone(input),
    });

    this.auditLog.push(entry);
  }
}
