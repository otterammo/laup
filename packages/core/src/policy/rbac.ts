import { z } from "zod";
import type { AuthIdentity } from "../auth/auth-types.js";
import type { PolicyScope } from "./evaluation-context.js";
import type { Policy } from "./policy-evaluator.js";

/**
 * Built-in RBAC roles (PERM-003), ordered by ascending privilege.
 */
export const BUILT_IN_ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

export const BuiltInRoleSchema = z.enum(BUILT_IN_ROLES);

const ROLE_PRIORITY: Record<BuiltInRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Built-in role -> granted action patterns.
 *
 * Role intent:
 * - viewer: read-only access
 * - editor: read/write access
 * - admin: read/write/delete + administrative actions
 * - owner: full access
 */
const ROLE_ACTIONS: Record<BuiltInRole, string[]> = {
  viewer: ["read"],
  editor: ["read", "write"],
  admin: ["read", "write", "delete", "admin"],
  owner: ["*"],
};

/**
 * Resolve and normalize built-in roles deterministically.
 * - trims and lowercases
 * - filters unknown roles
 * - de-duplicates
 * - sorts by privilege (viewer -> owner)
 */
export function resolveBuiltInRoles(roles: readonly string[]): BuiltInRole[] {
  const resolved = new Set<BuiltInRole>();

  for (const role of roles) {
    const normalized = role.trim().toLowerCase();
    const parsed = BuiltInRoleSchema.safeParse(normalized);
    if (parsed.success) {
      resolved.add(parsed.data);
    }
  }

  return [...resolved].sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b]);
}

/**
 * Resolve built-in roles from an authenticated identity.
 */
export function resolveIdentityRoles(identity: Pick<AuthIdentity, "roles">): BuiltInRole[] {
  return resolveBuiltInRoles(identity.roles);
}

export interface RolePolicyOptions {
  scope: PolicyScope;
  scopeId: string;
  resourceTypes?: string[];
  priority?: number;
  enabled?: boolean;
}

/**
 * Build deterministic allow policies from built-in roles.
 */
export function createRolePolicies(roles: readonly string[], options: RolePolicyOptions): Policy[] {
  const resolvedRoles = resolveBuiltInRoles(roles);
  const resourceTypes = options.resourceTypes ?? ["*"];

  return resolvedRoles.map((role) => ({
    id: `rbac:${options.scope}:${options.scopeId}:${role}`,
    name: `RBAC ${role}`,
    description: `Built-in ${role} role permission policy`,
    scope: options.scope,
    scopeId: options.scopeId,
    effect: "allow",
    actions: ROLE_ACTIONS[role],
    resourceTypes,
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  }));
}

/**
 * Build role policies directly from an authenticated identity.
 * Uses user scope and identity.id by default.
 */
export function createIdentityRolePolicies(
  identity: Pick<AuthIdentity, "id" | "roles">,
  options: Omit<RolePolicyOptions, "scope" | "scopeId"> & {
    scope?: PolicyScope;
    scopeId?: string;
  } = {},
): Policy[] {
  return createRolePolicies(identity.roles, {
    scope: options.scope ?? "user",
    scopeId: options.scopeId ?? identity.id,
    ...(options.resourceTypes !== undefined ? { resourceTypes: options.resourceTypes } : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}
