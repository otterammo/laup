import type { EvaluationContext, ScopeChainEntry } from "./evaluation-context.js";
import type { PermissionAuditLogger } from "./permission-audit.js";
import type {
  PermissionAuditEntry,
  PermissionAuditFilter,
  PermissionResult,
} from "./permission-audit-types.js";
import { type DefaultEffect, type Policy, PolicyEvaluator } from "./policy-evaluator.js";

export interface PolicySimulationRequest {
  candidatePolicies: Policy[];
  baselinePolicies?: Policy[];
  auditFilter?: PermissionAuditFilter;
  limit?: number;
  offset?: number;
  defaultEffect?: DefaultEffect;
}

export interface PolicySimulationRecord {
  auditId: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  resourceType?: string;
  historical: PermissionResult;
  candidate: PermissionResult;
  baseline?: PermissionResult;
  changedFromHistorical: boolean;
  changedFromBaseline: boolean;
  historicalToCandidateDelta: "none" | "allow_to_deny" | "deny_to_allow";
  baselineToCandidateDelta?: "none" | "allow_to_deny" | "deny_to_allow";
  matchedCandidatePolicyId?: string;
  matchedBaselinePolicyId?: string;
}

export interface PolicySimulationSummary {
  totalRecords: number;
  candidateAllowCount: number;
  candidateDenyCount: number;
  historicalAllowCount: number;
  historicalDenyCount: number;
  changedFromHistoricalCount: number;
  historicalAllowToDenyCount: number;
  historicalDenyToAllowCount: number;
  baselineAllowCount?: number;
  baselineDenyCount?: number;
  changedFromBaselineCount?: number;
  baselineAllowToDenyCount?: number;
  baselineDenyToAllowCount?: number;
}

export interface PolicySimulationResult {
  generatedAt: string;
  filter: PermissionAuditFilter;
  totalAuditsMatched: number;
  records: PolicySimulationRecord[];
  summary: PolicySimulationSummary;
}

export class PolicySimulationService {
  constructor(private readonly auditLogger: PermissionAuditLogger) {}

  async simulate(request: PolicySimulationRequest): Promise<PolicySimulationResult> {
    const filter = request.auditFilter ?? {};
    const limit = request.limit ?? 500;
    const offset = request.offset ?? 0;

    const auditPage = await this.auditLogger.query(filter, limit, offset);
    const sortedAudits = [...auditPage.entries].sort((a, b) => {
      const tsDiff = a.timestamp.localeCompare(b.timestamp);
      if (tsDiff !== 0) return tsDiff;
      return a.id.localeCompare(b.id);
    });

    const evaluator = new PolicyEvaluator({ defaultEffect: request.defaultEffect ?? "deny" });
    const baselineEvaluator = request.baselinePolicies
      ? new PolicyEvaluator({ defaultEffect: request.defaultEffect ?? "deny" })
      : undefined;

    const records: PolicySimulationRecord[] = sortedAudits.map((audit) => {
      const context = this.toEvaluationContext(audit);
      const candidateEval = evaluator.evaluate(context, request.candidatePolicies);
      const candidateResult: PermissionResult = candidateEval.allowed ? "allow" : "deny";

      const baselineEval = baselineEvaluator
        ? baselineEvaluator.evaluate(context, request.baselinePolicies ?? [])
        : undefined;
      const baselineResult = baselineEval ? (baselineEval.allowed ? "allow" : "deny") : undefined;

      const record: PolicySimulationRecord = {
        auditId: audit.id,
        timestamp: audit.timestamp,
        actor: audit.actor,
        action: audit.action,
        resource: audit.resource,
        historical: audit.result,
        candidate: candidateResult,
        changedFromHistorical: audit.result !== candidateResult,
        changedFromBaseline: baselineResult ? baselineResult !== candidateResult : false,
        historicalToCandidateDelta: toDelta(audit.result, candidateResult),
      };

      if (audit.resourceType) {
        record.resourceType = audit.resourceType;
      }
      if (baselineResult) {
        record.baseline = baselineResult;
        record.baselineToCandidateDelta = toDelta(baselineResult, candidateResult);
      }
      if (candidateEval.reason.matchedPolicyId) {
        record.matchedCandidatePolicyId = candidateEval.reason.matchedPolicyId;
      }
      if (baselineEval?.reason.matchedPolicyId) {
        record.matchedBaselinePolicyId = baselineEval.reason.matchedPolicyId;
      }

      return record;
    });

    return {
      generatedAt: new Date().toISOString(),
      filter,
      totalAuditsMatched: auditPage.total,
      records,
      summary: summarize(records, request.baselinePolicies !== undefined),
    };
  }

  private toEvaluationContext(entry: PermissionAuditEntry): EvaluationContext {
    const context = entry.context ?? {};
    const scopeChain = parseScopeChain(context["scopeChain"]);

    const actor: EvaluationContext["actor"] = {
      id: entry.actor,
      type: asString(context["actorType"]) ?? "user",
    };
    const actorAttributes = asObject(context["actorAttributes"]);
    if (actorAttributes) {
      actor.attributes = actorAttributes;
    }

    const resource: EvaluationContext["resource"] = {
      type: entry.resourceType ?? asString(context["resourceType"]) ?? "resource",
      id: entry.resource,
    };
    const resourceAttributes = asObject(context["resourceAttributes"]);
    if (resourceAttributes) {
      resource.attributes = resourceAttributes;
    }

    const environment = {
      ...asObject(context["environment"]),
      ...(entry.tool ? { tool: entry.tool } : {}),
      timestamp: entry.timestamp,
    };

    return {
      actor,
      action: entry.action,
      resource,
      scopeChain: scopeChain.length > 0 ? scopeChain : [{ scope: "user", id: entry.actor }],
      environment,
    };
  }
}

function summarize(
  records: PolicySimulationRecord[],
  hasBaseline: boolean,
): PolicySimulationSummary {
  const summary: PolicySimulationSummary = {
    totalRecords: records.length,
    candidateAllowCount: records.filter((record) => record.candidate === "allow").length,
    candidateDenyCount: records.filter((record) => record.candidate === "deny").length,
    historicalAllowCount: records.filter((record) => record.historical === "allow").length,
    historicalDenyCount: records.filter((record) => record.historical === "deny").length,
    changedFromHistoricalCount: records.filter((record) => record.changedFromHistorical).length,
    historicalAllowToDenyCount: records.filter(
      (record) => record.historicalToCandidateDelta === "allow_to_deny",
    ).length,
    historicalDenyToAllowCount: records.filter(
      (record) => record.historicalToCandidateDelta === "deny_to_allow",
    ).length,
  };

  if (hasBaseline) {
    summary.baselineAllowCount = records.filter((record) => record.baseline === "allow").length;
    summary.baselineDenyCount = records.filter((record) => record.baseline === "deny").length;
    summary.changedFromBaselineCount = records.filter(
      (record) => record.changedFromBaseline,
    ).length;
    summary.baselineAllowToDenyCount = records.filter(
      (record) => record.baselineToCandidateDelta === "allow_to_deny",
    ).length;
    summary.baselineDenyToAllowCount = records.filter(
      (record) => record.baselineToCandidateDelta === "deny_to_allow",
    ).length;
  }

  return summary;
}

function toDelta(
  from: PermissionResult,
  to: PermissionResult,
): "none" | "allow_to_deny" | "deny_to_allow" {
  if (from === to) return "none";
  return from === "allow" ? "allow_to_deny" : "deny_to_allow";
}

function parseScopeChain(value: unknown): ScopeChainEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as Record<string, unknown>;
    const scope = asString(candidate["scope"]);
    const id = asString(candidate["id"]);

    if (!scope || !id) {
      return [];
    }

    if (scope !== "user" && scope !== "project" && scope !== "team" && scope !== "org") {
      return [];
    }

    return [{ scope, id } as ScopeChainEntry];
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function createPolicySimulationService(
  auditLogger: PermissionAuditLogger,
): PolicySimulationService {
  return new PolicySimulationService(auditLogger);
}
