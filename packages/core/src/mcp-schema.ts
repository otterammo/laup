import { z } from "zod";

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
export const McpScopeSchema = z.enum(["org", "team", "project"]);

export type McpScope = z.infer<typeof McpScopeSchema>;

/**
 * MCP server credential reference (MCP-002).
 * References a credential in the secure credential store.
 */
export const McpCredentialRefSchema = z.object({
  /** Credential store key */
  key: z.string(),

  /** Credential type hint */
  type: z.enum(["api-key", "oauth", "basic", "bearer", "custom"]).optional(),

  /** Environment variable to inject (if applicable) */
  envVar: z.string().optional(),
});

export type McpCredentialRef = z.infer<typeof McpCredentialRefSchema>;

/**
 * MCP server version constraint (MCP-005).
 */
export const McpVersionPinSchema = z.object({
  /** Pinned version (semver) */
  version: z.string().optional(),

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
export const McpServerSchema = z.object({
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
});

export type McpServer = z.infer<typeof McpServerSchema>;

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

/**
 * Validate an MCP server configuration.
 */
export function validateMcpServer(server: unknown): McpValidationResult {
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

/**
 * Resolve effective servers with scope inheritance (MCP-004).
 * Lower scopes override higher scopes for the same server ID.
 */
export function resolveEffectiveServers(
  orgServers: McpServer[],
  teamServers: McpServer[],
  projectServers: McpServer[],
): McpServer[] {
  const byId = new Map<string, McpServer>();

  // Add org-level servers first
  for (const server of orgServers) {
    byId.set(server.id, server);
  }

  // Team servers override org
  for (const server of teamServers) {
    byId.set(server.id, server);
  }

  // Project servers override team/org
  for (const server of projectServers) {
    byId.set(server.id, server);
  }

  return Array.from(byId.values()).filter((s) => s.enabled);
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
