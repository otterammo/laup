import type { McpServer, McpVersionPin } from "./mcp-schema.js";
import { compareVersions, parseVersion, satisfies } from "./skill-version.js";

export type McpVersionNotificationType = "mcp.update-available" | "mcp.pin-drift";

export interface McpVersionNotification {
  id: string;
  type: McpVersionNotificationType;
  serverId: string;
  serverName: string;
  occurredAt: string;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
}

export interface McpVersionEvaluationInput {
  server: Pick<McpServer, "id" | "name" | "version">;
  observedVersion?: string;
  availableVersions?: string[];
}

export interface McpVersionEvaluation {
  serverId: string;
  pinnedVersion?: string;
  constraint?: string;
  observedVersion?: string;
  latestAvailableVersion?: string;
  latestAllowedVersion?: string;
  pinDrift: boolean;
  updateAvailable: boolean;
  observedWithinConstraint: boolean;
}

/**
 * Build a normalized semver constraint from MCP version pin settings.
 */
export function buildMcpVersionConstraint(pin?: McpVersionPin): string | undefined {
  if (!pin) return undefined;

  if (pin.constraint?.trim()) {
    return pin.constraint.trim();
  }

  const min = pin.minVersion?.trim();
  const max = pin.maxVersion?.trim();

  if (min && max) return `>=${min} <=${max}`;
  if (min) return `>=${min}`;
  if (max) return `<=${max}`;

  const pinned = pin.pinnedVersion?.trim() ?? pin.version?.trim();
  if (pinned) return pinned;

  return undefined;
}

/**
 * Determine pin drift and update availability for an MCP server.
 * Deterministic: available versions are normalized and sorted before comparison.
 */
export function evaluateMcpVersion(input: McpVersionEvaluationInput): McpVersionEvaluation {
  const pin = input.server.version;
  const pinnedVersion = pin?.pinnedVersion?.trim() ?? pin?.version?.trim();
  const constraint = buildMcpVersionConstraint(pin);

  const observedVersion = normalizeVersion(input.observedVersion);
  const normalizedAvailable = normalizeAndSortVersions(input.availableVersions ?? []);

  const latestAvailableVersion = normalizedAvailable[0];
  const allowedVersions = constraint
    ? normalizedAvailable.filter((version) => safeSatisfies(version, constraint))
    : normalizedAvailable;
  const latestAllowedVersion = allowedVersions[0];

  const pinDrift =
    Boolean(pinnedVersion) &&
    Boolean(observedVersion) &&
    compareVersions(observedVersion!, pinnedVersion!) !== 0;

  const observedWithinConstraint =
    !constraint || !observedVersion ? true : safeSatisfies(observedVersion, constraint);

  let baseline = observedVersion;
  if (pinnedVersion) {
    baseline = pinnedVersion;
  }

  const updateAvailable =
    Boolean(baseline) &&
    Boolean(latestAllowedVersion) &&
    compareVersions(latestAllowedVersion!, baseline!) > 0;

  return {
    serverId: input.server.id,
    ...(pinnedVersion ? { pinnedVersion } : {}),
    ...(constraint ? { constraint } : {}),
    ...(observedVersion ? { observedVersion } : {}),
    ...(latestAvailableVersion ? { latestAvailableVersion } : {}),
    ...(latestAllowedVersion ? { latestAllowedVersion } : {}),
    pinDrift,
    updateAvailable,
    observedWithinConstraint,
  };
}

/**
 * Build notification payloads for MCP version state changes.
 */
export function buildMcpVersionNotifications(
  input: McpVersionEvaluationInput,
  occurredAt: Date = new Date(),
): McpVersionNotification[] {
  const evaluation = evaluateMcpVersion(input);
  const notifications: McpVersionNotification[] = [];
  const timestamp = occurredAt.toISOString();

  if (evaluation.pinDrift && evaluation.pinnedVersion && evaluation.observedVersion) {
    notifications.push({
      id: `mcp-pin-drift:${input.server.id}:${evaluation.pinnedVersion}:${evaluation.observedVersion}`,
      type: "mcp.pin-drift",
      serverId: input.server.id,
      serverName: input.server.name,
      occurredAt: timestamp,
      title: "MCP version pin drift detected",
      summary: `${input.server.name} is running ${evaluation.observedVersion} but pinned to ${evaluation.pinnedVersion}`,
      metadata: {
        pinnedVersion: evaluation.pinnedVersion,
        observedVersion: evaluation.observedVersion,
        constraint: evaluation.constraint,
        observedWithinConstraint: evaluation.observedWithinConstraint,
      },
    });
  }

  if (evaluation.updateAvailable && evaluation.latestAllowedVersion) {
    const currentVersion = evaluation.pinnedVersion ?? evaluation.observedVersion;
    notifications.push({
      id: `mcp-update-available:${input.server.id}:${currentVersion ?? "unknown"}:${evaluation.latestAllowedVersion}`,
      type: "mcp.update-available",
      serverId: input.server.id,
      serverName: input.server.name,
      occurredAt: timestamp,
      title: "MCP server update available",
      summary: `${input.server.name} can be updated from ${currentVersion ?? "unknown"} to ${evaluation.latestAllowedVersion}`,
      metadata: {
        currentVersion,
        latestAllowedVersion: evaluation.latestAllowedVersion,
        latestAvailableVersion: evaluation.latestAvailableVersion,
        pinnedVersion: evaluation.pinnedVersion,
        constraint: evaluation.constraint,
      },
    });
  }

  return notifications;
}

function normalizeAndSortVersions(versions: string[]): string[] {
  const unique = new Set<string>();

  for (const raw of versions) {
    const normalized = normalizeVersion(raw);
    if (normalized) unique.add(normalized);
  }

  return Array.from(unique).sort((a, b) => compareVersions(b, a));
}

function normalizeVersion(version?: string): string | undefined {
  const trimmed = version?.trim();
  if (!trimmed) return undefined;
  return parseVersion(trimmed) ? trimmed : undefined;
}

function safeSatisfies(version: string, constraint: string): boolean {
  try {
    return satisfies(version, constraint);
  } catch {
    return false;
  }
}
