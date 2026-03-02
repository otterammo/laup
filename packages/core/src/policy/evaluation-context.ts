/**
 * Policy Evaluation Context
 *
 * Defines the context required to evaluate permission policies.
 * Part of PERM-004: Policy evaluation with documented priority order.
 */

import type { Scope } from "../scope.js";

/**
 * Scope chain entry representing a scope with its identifier.
 * Used to determine scope priority during policy evaluation.
 */
export interface ScopeChainEntry {
  /** The scope type (org, team, project, user) */
  scope: PolicyScope;
  /** The identifier for this scope (e.g., org ID, team ID) */
  id: string;
}

/**
 * Extended scope type that includes user scope for policy evaluation.
 * Policy priority: org > team > project > user (higher scope overrides lower).
 *
 * Note: This extends the base Scope type from scope.ts with 'user' scope.
 */
export type PolicyScope = Scope | "user";

/**
 * Actor performing the action.
 * Represents the entity (user, service, etc.) requesting permission.
 */
export interface Actor {
  /** Unique identifier for the actor */
  id: string;
  /** Actor type (user, service, api-key, etc.) */
  type: string;
  /** Optional actor attributes for attribute-based access control */
  attributes?: Record<string, unknown>;
}

/**
 * Resource being accessed.
 * Represents the target of the permission check.
 */
export interface Resource {
  /** Resource type (e.g., "skill", "document", "setting") */
  type: string;
  /** Optional unique identifier for the specific resource */
  id?: string;
  /** Optional resource attributes for fine-grained access control */
  attributes?: Record<string, unknown>;
}

/**
 * Evaluation context for policy decisions.
 *
 * Contains all information needed to evaluate a set of policies:
 * - Who is performing the action (actor)
 * - What action is being performed
 * - What resource is being accessed
 * - The scope chain from most specific to least specific
 */
export interface EvaluationContext {
  /**
   * The actor performing the action.
   * Used to match policies that target specific actors or actor types.
   */
  actor: Actor;

  /**
   * The action being performed.
   * Examples: "read", "write", "delete", "execute", "admin"
   */
  action: string;

  /**
   * The resource being accessed.
   * Used to match policies that target specific resource types or instances.
   */
  resource: Resource;

  /**
   * The scope chain from most specific (first) to least specific (last).
   * Example: [{ scope: "user", id: "u1" }, { scope: "project", id: "p1" }, { scope: "team", id: "t1" }, { scope: "org", id: "o1" }]
   *
   * This determines which scopes the actor is operating within.
   * Policies from higher scopes (org) take priority over lower scopes (user).
   */
  scopeChain: ScopeChainEntry[];

  /**
   * Optional environment context for conditional policies.
   * Examples: time of day, IP address, device type
   */
  environment?: Record<string, unknown>;
}

/**
 * Creates a basic evaluation context with required fields.
 *
 * @param actor - The actor performing the action
 * @param action - The action being performed
 * @param resource - The resource being accessed
 * @param scopeChain - The scope chain (most specific first)
 * @returns A complete evaluation context
 */
export function createEvaluationContext(
  actor: Actor,
  action: string,
  resource: Resource,
  scopeChain: ScopeChainEntry[],
): EvaluationContext {
  return {
    actor,
    action,
    resource,
    scopeChain,
  };
}
