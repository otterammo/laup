import { z } from "zod";
import type { AuditCategory, AuditEntry, AuditStorage } from "../audit-storage.js";

export const ComplianceReportProfileSchema = z.enum(["soc2", "iso27001"]);
export type ComplianceReportProfile = z.infer<typeof ComplianceReportProfileSchema>;

export const ComplianceControlStatusSchema = z.enum(["covered", "no-evidence"]);
export type ComplianceControlStatus = z.infer<typeof ComplianceControlStatusSchema>;

export const ComplianceReportEvidenceSchema = z.object({
  sourceEventId: z.string(),
  timestamp: z.string(),
  category: z.string(),
  action: z.string(),
  severity: z.string(),
  actor: z.string(),
  targetId: z.string().optional(),
  targetType: z.string().optional(),
  correlationId: z.string().optional(),
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ComplianceReportEvidence = z.infer<typeof ComplianceReportEvidenceSchema>;

export const ComplianceReportControlSchema = z.object({
  controlId: z.string(),
  section: z.string(),
  title: z.string(),
  description: z.string(),
  status: ComplianceControlStatusSchema,
  evidenceCount: z.number().int().nonnegative(),
  evidence: z.array(ComplianceReportEvidenceSchema),
});

export type ComplianceReportControl = z.infer<typeof ComplianceReportControlSchema>;

export const ComplianceReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  reportId: z.string(),
  generatedAt: z.string(),
  profile: z.object({
    id: ComplianceReportProfileSchema,
    name: z.string(),
    version: z.string(),
  }),
  range: z.object({
    startTime: z.string(),
    endTime: z.string(),
  }),
  summary: z.object({
    totalEvents: z.number().int().nonnegative(),
    totalEvidence: z.number().int().nonnegative(),
    controlsCovered: z.number().int().nonnegative(),
    controlsMissingEvidence: z.number().int().nonnegative(),
    eventsByCategory: z.record(z.string(), z.number().int().nonnegative()),
    eventsBySeverity: z.record(z.string(), z.number().int().nonnegative()),
  }),
  controls: z.array(ComplianceReportControlSchema),
  evidenceIndex: z.array(ComplianceReportEvidenceSchema),
});

export type ComplianceReport = z.infer<typeof ComplianceReportSchema>;

export interface ComplianceReportGenerateInput {
  profile: ComplianceReportProfile;
  startTime: Date;
  endTime: Date;
}

export interface ComplianceReportServiceConfig {
  auditStorage: AuditStorage;
  now?: () => Date;
}

export interface ComplianceEvidenceMatcher {
  actions?: string[];
  actionPrefixes?: string[];
  categories?: AuditCategory[];
  metadataEquals?: Record<string, unknown>;
}

export interface ComplianceControlDefinition {
  controlId: string;
  section: string;
  title: string;
  description: string;
  matchers: ComplianceEvidenceMatcher[];
}

export interface ComplianceProfileDefinition {
  id: ComplianceReportProfile;
  name: string;
  version: string;
  controls: ComplianceControlDefinition[];
}

const PROFILE_DEFINITIONS: Record<ComplianceReportProfile, ComplianceProfileDefinition> = {
  soc2: {
    id: "soc2",
    name: "SOC 2 Trust Services Criteria",
    version: "2017",
    controls: [
      {
        controlId: "CC6.1",
        section: "Common Criteria - Logical and Physical Access Controls",
        title: "Logical access provisioning and enforcement",
        description:
          "Access to systems is provisioned and enforced according to approved policies.",
        matchers: [
          { actions: ["approval.request", "approval.approve", "approval.deny"] },
          {
            actions: [
              "resource-guard.enforce.allow",
              "resource-guard.enforce.deny",
              "permission.evaluate",
            ],
          },
        ],
      },
      {
        controlId: "CC7.2",
        section: "Common Criteria - System Operations",
        title: "Anomaly and threat detection",
        description: "Security events are monitored and anomalous behavior is detected.",
        matchers: [
          { actionPrefixes: ["permission.anomaly."] },
          { actions: ["rate-limit.enforce.deny", "hook.pre.veto", "authenticate.failure"] },
        ],
      },
      {
        controlId: "CC7.3",
        section: "Common Criteria - Change Management",
        title: "Security incident response",
        description: "Identified security incidents are contained, investigated, and resolved.",
        matchers: [
          { actions: ["kill-switch.activate", "kill-switch.deactivate"] },
          { actions: ["approval.enforce.deny", "approval.enforce.expired"] },
        ],
      },
      {
        controlId: "CC8.1",
        section: "Common Criteria - Change Management",
        title: "Policy and configuration change governance",
        description: "Changes are authorized, tested, and tracked through audit logs.",
        matchers: [
          { categories: ["config"] },
          { actionPrefixes: ["policy."] },
          { actions: ["approval.request"] },
        ],
      },
    ],
  },
  iso27001: {
    id: "iso27001",
    name: "ISO/IEC 27001 Annex A",
    version: "2022",
    controls: [
      {
        controlId: "A.5.15",
        section: "Organizational controls",
        title: "Access control",
        description: "Access to information and systems is restricted according to policy.",
        matchers: [
          {
            actions: [
              "permission.evaluate",
              "resource-guard.enforce.allow",
              "resource-guard.enforce.deny",
            ],
          },
          { actionPrefixes: ["approval."] },
        ],
      },
      {
        controlId: "A.5.24",
        section: "Organizational controls",
        title: "Information security incident management planning",
        description:
          "Security incidents are identified, escalated, and managed through defined procedures.",
        matchers: [
          { actions: ["kill-switch.activate", "kill-switch.deactivate"] },
          { actionPrefixes: ["permission.anomaly."] },
          { actions: ["approval.enforce.deny", "approval.enforce.expired"] },
        ],
      },
      {
        controlId: "A.8.15",
        section: "Technological controls",
        title: "Logging",
        description:
          "Event logs are produced, protected, and reviewed for security-relevant actions.",
        matchers: [
          { categories: ["auth", "security", "access"] },
          { actions: ["authenticate.failure", "authenticate.success"] },
        ],
      },
      {
        controlId: "A.8.16",
        section: "Technological controls",
        title: "Monitoring activities",
        description: "Systems are monitored to detect and respond to anomalous activities.",
        matchers: [
          { actionPrefixes: ["permission.anomaly."] },
          { actions: ["rate-limit.enforce.deny", "hook.pre.veto"] },
        ],
      },
    ],
  },
};

export class ComplianceReportService {
  private readonly now: () => Date;

  constructor(private readonly config: ComplianceReportServiceConfig) {
    this.now = config.now ?? (() => new Date());
  }

  async generate(input: ComplianceReportGenerateInput): Promise<ComplianceReport> {
    const profile = PROFILE_DEFINITIONS[input.profile];
    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    const events = await this.fetchEntries(startTime, endTime);

    const controls = profile.controls
      .map((control) => {
        const evidence = events.filter((entry) =>
          control.matchers.some((matcher) => matches(entry, matcher)),
        );
        const mappedEvidence = evidence.map(mapEvidence);
        return {
          controlId: control.controlId,
          section: control.section,
          title: control.title,
          description: control.description,
          status: mappedEvidence.length > 0 ? "covered" : "no-evidence",
          evidenceCount: mappedEvidence.length,
          evidence: mappedEvidence,
        } satisfies ComplianceReportControl;
      })
      .sort((a, b) => a.controlId.localeCompare(b.controlId));

    const evidenceIndex = dedupeEvidence(controls.flatMap((control) => control.evidence)).sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
        a.sourceEventId.localeCompare(b.sourceEventId),
    );

    const summary = {
      totalEvents: events.length,
      totalEvidence: evidenceIndex.length,
      controlsCovered: controls.filter((control) => control.status === "covered").length,
      controlsMissingEvidence: controls.filter((control) => control.status === "no-evidence")
        .length,
      eventsByCategory: countBy(events, (entry) => entry.category),
      eventsBySeverity: countBy(events, (entry) => entry.severity),
    };

    return {
      schemaVersion: "1.0",
      reportId: `compliance:${profile.id}:${startTime.toISOString()}:${endTime.toISOString()}`,
      generatedAt: this.now().toISOString(),
      profile: {
        id: profile.id,
        name: profile.name,
        version: profile.version,
      },
      range: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
      summary,
      controls,
      evidenceIndex,
    };
  }

  async generateSerialized(
    input: ComplianceReportGenerateInput,
    format: "json" | "jsonl" = "json",
  ): Promise<string> {
    const report = await this.generate(input);
    if (format === "json") {
      return JSON.stringify(report, null, 2);
    }

    const rows = report.evidenceIndex.map((evidence) => JSON.stringify(evidence));
    return rows.join("\n");
  }

  private async fetchEntries(startTime: Date, endTime: Date): Promise<AuditEntry[]> {
    const pageSize = 500;
    let offset = 0;
    const entries: AuditEntry[] = [];

    while (true) {
      const page = await this.config.auditStorage.query({ startTime, endTime }, pageSize, offset);
      entries.push(...page.entries);
      if (!page.hasMore) {
        break;
      }
      offset += pageSize;
    }

    return entries.sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id),
    );
  }
}

export function createComplianceReportService(
  config: ComplianceReportServiceConfig,
): ComplianceReportService {
  return new ComplianceReportService(config);
}

export function getComplianceProfileDefinition(
  profile: ComplianceReportProfile,
): ComplianceProfileDefinition {
  return PROFILE_DEFINITIONS[profile];
}

function mapEvidence(entry: AuditEntry): ComplianceReportEvidence {
  return {
    sourceEventId: entry.id,
    timestamp: entry.timestamp,
    category: entry.category,
    action: entry.action,
    severity: entry.severity,
    actor: entry.actor,
    targetId: entry.targetId,
    targetType: entry.targetType,
    correlationId: entry.correlationId,
    reason: entry.reason,
    metadata: entry.metadata,
  };
}

function dedupeEvidence(evidence: ComplianceReportEvidence[]): ComplianceReportEvidence[] {
  const deduped = new Map<string, ComplianceReportEvidence>();
  for (const item of evidence) {
    deduped.set(item.sourceEventId, item);
  }
  return [...deduped.values()];
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function matches(entry: AuditEntry, matcher: ComplianceEvidenceMatcher): boolean {
  if (matcher.actions && !matcher.actions.includes(entry.action)) {
    return false;
  }

  if (
    matcher.actionPrefixes &&
    !matcher.actionPrefixes.some((prefix) => entry.action.startsWith(prefix))
  ) {
    return false;
  }

  if (matcher.categories && !matcher.categories.includes(entry.category)) {
    return false;
  }

  if (matcher.metadataEquals) {
    for (const [key, value] of Object.entries(matcher.metadataEquals)) {
      if (entry.metadata?.[key] !== value) {
        return false;
      }
    }
  }

  return true;
}
