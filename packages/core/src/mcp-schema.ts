import { z } from "zod";
import type { CredentialStore, CredentialType } from "./credential-store.js";

/**
 * MCP server transport type.
 */
export const McpTransportSchema = z.enum(["stdio", "http", "websocket"]);

export type McpTransport = z.infer<typeof McpTransportSchema>;

/**
 * MCP server health status.
 */
export const McpHealthStatusSchema = z.enum(["healthy", "degraded", "unhealthy", "unknown"]);

export type McpHealthStatus = z.infer<typeof McpHealthStatusSchema>;

/**
 * MCP server scope level (MCP-004).
 */
export const McpScopeSchema = z.enum(["org", "team", "project", "user"]);

export type McpScope = z.infer<typeof McpScopeSchema>;

/**
 * MCP server credential reference (MCP-002).
 * References a credential in the secure credential store.
 */
export const McpCredentialRefSchema = z
  .object({
    /** Credential store key */
    key: z.string(),

    /** Credential type hint */
    type: z.enum(["api-key", "oauth", "basic", "bearer", "custom"]).optional(),

    /** Environment variable to inject (if applicable) */
    envVar: z.string().optional(),
  })
  .strict();

export type McpCredentialRef = z.infer<typeof McpCredentialRefSchema>;

/**
 * MCP server version constraint (MCP-005).
 */
export const McpVersionPinSchema = z.object({
  /** Legacy pinned version (semver) */
  version: z.string().optional(),

  /** Preferred explicit pinned version (semver) */
  pinnedVersion: z.string().optional(),

  /** Semver constraint string (example: ">=1.2.0 <2.0.0") */
  constraint: z.string().optional(),

  /** Minimum version constraint */
  minVersion: z.string().optional(),

  /** Maximum version constraint */
  maxVersion: z.string().optional(),

  /** Whether to auto-update within constraints */
  autoUpdate: z.boolean().optional(),

  /** Notification preference for updates */
  notifyOnUpdate: z.boolean().optional(),
});

export type McpVersionPin = z.infer<typeof McpVersionPinSchema>;

/**
 * MCP server health check configuration (MCP-003).
 */
export const McpHealthCheckSchema = z.object({
  /** Enable periodic health checks */
  enabled: z.boolean().default(true),

  /** Health check interval in seconds */
  intervalSeconds: z.number().min(10).default(60),

  /** Timeout for health check in seconds */
  timeoutSeconds: z.number().min(1).default(10),

  /** Number of failures before marking unhealthy */
  failureThreshold: z.number().min(1).default(3),

  /** Number of successes before marking healthy */
  successThreshold: z.number().min(1).default(1),

  /** Custom health check endpoint (for HTTP servers) */
  endpoint: z.string().optional(),
});

export type McpHealthCheck = z.infer<typeof McpHealthCheckSchema>;

/**
 * MCP server registration (MCP-001 to MCP-008).
 */
export const McpServerSchema = z
  .object({
    /** Unique server ID (namespace/name format) */
    id: z.string().regex(/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?$/i),

    /** Human-readable name */
    name: z.string(),

    /** Server description */
    description: z.string().optional(),

    /** Transport type */
    transport: McpTransportSchema,

    /** Server command (for stdio transport) */
    command: z.string().optional(),

    /** Command arguments */
    args: z.array(z.string()).optional(),

    /** Server URL (for http/websocket transport) */
    url: z.string().url().optional(),

    /** Environment variables to set */
    env: z.record(z.string(), z.string()).optional(),

    /** Credential reference (MCP-002) */
    credentials: McpCredentialRefSchema.optional(),

    /** Scope level (MCP-004) */
    scope: McpScopeSchema.default("project"),

    /** Scope ID (org/team/project ID) */
    scopeId: z.string().optional(),

    /** Version pinning (MCP-005) */
    version: McpVersionPinSchema.optional(),

    /** Health check configuration (MCP-003) */
    healthCheck: McpHealthCheckSchema.optional(),

    /** Tools this server supports */
    tools: z.array(z.string()).optional(),

    /** Server capabilities */
    capabilities: z.array(z.string()).optional(),

    /** Whether server is enabled */
    enabled: z.boolean().default(true),

    /** Registration timestamp */
    registeredAt: z.string().optional(),

    /** Last update timestamp */
    updatedAt: z.string().optional(),
  })
  .strict();

export type McpServer = z.infer<typeof McpServerSchema>;

const PLAINTEXT_CREDENTIAL_KEYS = new Set([
  "apikey",
  "api_key",
  "token",
  "access_token",
  "bearer",
  "bearer_token",
  "password",
  "secret",
  "clientsecret",
  "client_secret",
  "credential",
  "credentialvalue",
  "value",
]);

const LEGACY_CREDENTIAL_KEY_HINTS = [
  "apiKey",
  "api_key",
  "token",
  "accessToken",
  "access_token",
  "bearerToken",
  "bearer_token",
  "password",
  "secret",
  "clientSecret",
  "client_secret",
  "credential",
  "credentialValue",
  "value",
] as const;

interface PlaintextCredentialIssue {
  path: string;
  message: string;
}

interface ExtractedCredential {
  path: string;
  value: string;
  hint?: string;
}

function toCredentialType(hint?: string): CredentialType {
  const normalized = hint?.toLowerCase() ?? "";
  if (normalized.includes("api")) return "api-key";
  if (normalized.includes("password")) return "password";
  if (normalized.includes("token") || normalized.includes("bearer")) return "oauth-token";
  return "other";
}

function toMcpCredentialHint(hint?: string): McpCredentialRef["type"] {
  const normalized = hint?.toLowerCase() ?? "";
  if (normalized.includes("api")) return "api-key";
  if (normalized.includes("token")) return "oauth";
  if (normalized.includes("bearer")) return "bearer";
  if (normalized.includes("password")) return "basic";
  return "custom";
}

function collectPlaintextCredentialIssues(
  value: unknown,
  path = "",
  issues: PlaintextCredentialIssue[] = [],
): PlaintextCredentialIssue[] {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectPlaintextCredentialIssues(value[i], `${path}[${i}]`, issues);
    }
    return issues;
  }

  if (!value || typeof value !== "object") return issues;

  for (const [key, child] of Object.entries(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    const normalizedKey = key.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();

    if (
      PLAINTEXT_CREDENTIAL_KEYS.has(normalizedKey) &&
      typeof child === "string" &&
      child.trim().length > 0
    ) {
      // credentials.key is a secure store reference and must be allowed.
      if (keyPath !== "credentials.key") {
        issues.push({
          path: keyPath,
          message:
            "Plaintext credentials are not allowed. Use credentials.key (credential store ID).",
        });
      }
    }

    collectPlaintextCredentialIssues(child, keyPath, issues);
  }

  return issues;
}

function extractLegacyCredential(value: unknown): ExtractedCredential | null {
  if (!value || typeof value !== "object") return null;

  const root = value as Record<string, unknown>;
  const credentials =
    root["credentials"] && typeof root["credentials"] === "object"
      ? (root["credentials"] as Record<string, unknown>)
      : undefined;

  for (const hint of LEGACY_CREDENTIAL_KEY_HINTS) {
    const topLevel = root[hint];
    if (typeof topLevel === "string" && topLevel.trim().length > 0) {
      return { path: hint, value: topLevel, hint };
    }

    if (credentials) {
      const nested = credentials[hint];
      if (typeof nested === "string" && nested.trim().length > 0) {
        return { path: `credentials.${hint}`, value: nested, hint };
      }
    }
  }

  return null;
}

/**
 * MCP server health state (MCP-003).
 */
export interface McpLastCheckStatus {
  checkedAt: number;
  durationMs: number;
  success: boolean;
  timedOut: boolean;
  retries: number;
  message?: string;
  error?: string;
}

export interface McpHealthState {
  serverId: string;
  status: McpHealthStatus;
  lastCheck: number;
  lastSuccess?: number;
  lastFailure?: number;
  consecutiveFailures: number;
  message?: string;
  lastCheckStatus?: McpLastCheckStatus;
}

/**
 * MCP registry operation for audit trail (MCP-006).
 */
export const McpAuditOperationSchema = z.enum([
  "register",
  "update",
  "deregister",
  "enable",
  "disable",
  "health-change",
]);

export type McpAuditOperation = z.infer<typeof McpAuditOperationSchema>;

/**
 * MCP audit log entry (MCP-006).
 */
export const McpAuditEntrySchema = z.object({
  /** Unique entry ID */
  id: z.string(),

  /** Server ID */
  serverId: z.string(),

  /** Operation type */
  operation: McpAuditOperationSchema,

  /** User/agent that performed the operation */
  actor: z.string(),

  /** Timestamp */
  timestamp: z.string(),

  /** Previous state (for updates) */
  previousState: z.unknown().optional(),

  /** New state */
  newState: z.unknown().optional(),

  /** Operation reason/comment */
  reason: z.string().optional(),
});

export type McpAuditEntry = z.infer<typeof McpAuditEntrySchema>;

/**
 * Validate an MCP server registration.
 */
export interface McpValidationResult {
  valid: boolean;
  server?: McpServer;
  issues: Array<{
    path: string;
    message: string;
  }>;
}

export interface NormalizeMcpServerOptions {
  credentialStore: CredentialStore;
  ownerId: string;
  ownerType: "user" | "team" | "org";
  accessorId: string;
  service?: string;
}

/**
 * Validate an MCP server configuration.
 */
export function validateMcpServer(server: unknown): McpValidationResult {
  const plaintextIssues = collectPlaintextCredentialIssues(server);
  if (plaintextIssues.length > 0) {
    return { valid: false, issues: plaintextIssues };
  }

  const result = McpServerSchema.safeParse(server);

  if (result.success) {
    // Additional validation
    const data = result.data;
    const issues: Array<{ path: string; message: string }> = [];

    // Validate transport-specific fields
    if (data.transport === "stdio" && !data.command) {
      issues.push({
        path: "command",
        message: "Command is required for stdio transport",
      });
    }

    if ((data.transport === "http" || data.transport === "websocket") && !data.url) {
      issues.push({
        path: "url",
        message: `URL is required for ${data.transport} transport`,
      });
    }

    if (issues.length > 0) {
      return { valid: false, issues };
    }

    return { valid: true, server: data, issues: [] };
  }

  return {
    valid: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/**
 * Normalize MCP server credentials to credential-store references.
 *
 * Existing credential references are preserved. Legacy plaintext credential fields
 * are migrated into credential-store entries and replaced with credentials.key.
 */
export async function normalizeMcpServerCredentials(
  server: unknown,
  options: NormalizeMcpServerOptions,
): Promise<McpServer> {
  const parsed =
    typeof server === "object" && server !== null
      ? (structuredClone(server) as Record<string, unknown>)
      : null;

  if (!parsed) {
    throw new Error("MCP server config must be an object");
  }

  const legacyCredential = extractLegacyCredential(parsed);

  if (!legacyCredential) {
    const validation = validateMcpServer(parsed);
    if (!validation.valid || !validation.server) {
      throw new Error(validation.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    }
    return validation.server;
  }

  const credentialId = await options.credentialStore.store(
    {
      name: `mcp/${String(parsed["id"] ?? "server")}`,
      description: `Migrated MCP credential from ${legacyCredential.path}`,
      type: toCredentialType(legacyCredential.hint),
      service: options.service ?? "mcp",
      ownerId: options.ownerId,
      ownerType: options.ownerType,
    },
    legacyCredential.value,
  );

  const credentialsObj =
    parsed["credentials"] && typeof parsed["credentials"] === "object"
      ? (parsed["credentials"] as Record<string, unknown>)
      : {};

  parsed["credentials"] = {
    key: credentialId,
    type: toMcpCredentialHint(legacyCredential.hint),
    ...(typeof credentialsObj["envVar"] === "string" ? { envVar: credentialsObj["envVar"] } : {}),
  };

  const [rootPath, nestedPath] = legacyCredential.path.split(".");
  if (nestedPath && rootPath === "credentials") {
    delete credentialsObj[nestedPath];
  } else {
    delete parsed[legacyCredential.path];
  }

  const validation = validateMcpServer(parsed);
  if (!validation.valid || !validation.server) {
    throw new Error(validation.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  }

  void options.accessorId;
  return validation.server;
}

/**
 * Resolve MCP credential reference to secret value from credential store.
 */
export async function resolveMcpCredentialValue(
  server: McpServer,
  credentialStore: CredentialStore,
  accessorId: string,
): Promise<string | null> {
  if (!server.credentials?.key) return null;
  return credentialStore.get(server.credentials.key, accessorId);
}

/**
 * Check if a server is in healthy state.
 */
export function isServerHealthy(state: McpHealthState): boolean {
  return state.status === "healthy";
}

/**
 * Get servers at a specific scope level.
 */
export function getServersAtScope(
  servers: McpServer[],
  scope: McpScope,
  scopeId?: string,
): McpServer[] {
  return servers.filter((s) => {
    if (s.scope !== scope) return false;
    if (scopeId && s.scopeId !== scopeId) return false;
    return true;
  });
}

/** Scope precedence for MCP server inheritance (MCP-004). */
export const MCP_SCOPE_PRECEDENCE: readonly McpScope[] = ["org", "team", "project", "user"];

/** Returns precedence index for a scope (higher = more specific). */
export function mcpScopePrecedence(scope: McpScope): number {
  return MCP_SCOPE_PRECEDENCE.indexOf(scope);
}

export interface McpScopeContext {
  orgId?: string;
  teamId?: string;
  projectId?: string;
  userId?: string;
}

/**
 * Scope chain (least to most specific) for a target scope.
 */
export function getMcpScopeChain(targetScope: McpScope): McpScope[] {
  const targetIndex = mcpScopePrecedence(targetScope);
  if (targetIndex < 0) return [];
  return MCP_SCOPE_PRECEDENCE.slice(0, targetIndex + 1);
}

/**
 * Returns true if a server applies to the given scope context.
 */
export function serverAppliesToScope(server: McpServer, context: McpScopeContext): boolean {
  switch (server.scope) {
    case "org":
      return !server.scopeId || server.scopeId === context.orgId;
    case "team":
      return !server.scopeId || server.scopeId === context.teamId;
    case "project":
      return !server.scopeId || server.scopeId === context.projectId;
    case "user":
      return !server.scopeId || server.scopeId === context.userId;
    default:
      return false;
  }
}

/**
 * Resolve effective servers with deterministic scope inheritance (MCP-004).
 *
 * Conflict resolution for identical server IDs:
 * 1. Higher scope precedence wins: user > project > team > org
 * 2. Within same scope: newer `updatedAt` wins
 * 3. Then newer `registeredAt` wins
 * 4. Finally, stable lexical sort by id/scope/scopeId for deterministic behavior
 */
export function resolveInheritedMcpServers(
  servers: McpServer[],
  targetScope: McpScope,
  context: McpScopeContext = {},
): McpServer[] {
  const applicableScopes = new Set(getMcpScopeChain(targetScope));

  const applicable = servers
    .filter((server) => applicableScopes.has(server.scope) && serverAppliesToScope(server, context))
    .sort((a, b) => {
      const idCompare = a.id.localeCompare(b.id);
      if (idCompare !== 0) return idCompare;

      const scopeCompare = mcpScopePrecedence(a.scope) - mcpScopePrecedence(b.scope);
      if (scopeCompare !== 0) return scopeCompare;

      const aUpdated = Date.parse(a.updatedAt ?? "");
      const bUpdated = Date.parse(b.updatedAt ?? "");
      if (!Number.isNaN(aUpdated) && !Number.isNaN(bUpdated) && aUpdated !== bUpdated) {
        return aUpdated - bUpdated;
      }

      const aRegistered = Date.parse(a.registeredAt ?? "");
      const bRegistered = Date.parse(b.registeredAt ?? "");
      if (!Number.isNaN(aRegistered) && !Number.isNaN(bRegistered) && aRegistered !== bRegistered) {
        return aRegistered - bRegistered;
      }

      return (a.scopeId ?? "").localeCompare(b.scopeId ?? "");
    });

  const byId = new Map<string, McpServer>();

  for (const server of applicable) {
    byId.set(server.id, server);
  }

  return Array.from(byId.values()).filter((s) => s.enabled);
}

/**
 * Integration helper: resolve effective server list for a scope from flat registry data.
 */
export function getEffectiveServersForScope(
  servers: McpServer[],
  targetScope: McpScope,
  context: McpScopeContext = {},
): McpServer[] {
  return resolveInheritedMcpServers(servers, targetScope, context);
}

/**
 * Backward-compatible resolver for explicit org/team/project buckets.
 */
export function resolveEffectiveServers(
  orgServers: McpServer[],
  teamServers: McpServer[],
  projectServers: McpServer[],
  userServers: McpServer[] = [],
): McpServer[] {
  return resolveInheritedMcpServers(
    [...orgServers, ...teamServers, ...projectServers, ...userServers],
    userServers.length > 0 ? "user" : "project",
  );
}

/**
 * Check if deregistration would leave orphaned references (MCP-007).
 */
export interface OrphanCheckResult {
  safe: boolean;
  references: Array<{
    type: "skill" | "tool" | "workflow";
    id: string;
    name: string;
  }>;
}

/**
 * Parse server ID into namespace and name.
 */
export function parseServerId(id: string): { namespace?: string; name: string } {
  const parts = id.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { namespace: parts[0], name: parts[1] };
  }
  return { name: id };
}
