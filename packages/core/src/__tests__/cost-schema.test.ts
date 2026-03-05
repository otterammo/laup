import { describe, expect, it } from "vitest";
import {
  aggregateSkillCostAttribution,
  aggregateUsage,
  aggregateUsageByAttribution,
  aggregateUsageByAttributions,
  aggregateUsageByDeveloper,
  aggregateUsageByProject,
  aggregateUsageBySkill,
  aggregateUsageByTeam,
  type BudgetAlert,
  BudgetAlertSchema,
  type CostCap,
  calculateLlmCost,
  evaluateCostCap,
  exportCostSummary,
  isCostCapExceeded,
  type LlmUsage,
  type ModelPricing,
  matchesCostCapScope,
  projectPeriodCost,
  shouldFireAlert,
  type UsageEvent,
} from "../cost-schema.js";

describe("cost-schema", () => {
  const samplePricing: ModelPricing = {
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputCostPerMillion: 3.0,
    outputCostPerMillion: 15.0,
    cacheReadCostPerMillion: 0.3,
    cacheWriteCostPerMillion: 3.75,
    effectiveDate: "2026-01-01",
    currency: "USD",
  };

  const sampleLlmUsage: LlmUsage = {
    provider: "anthropic",
    model: "claude-sonnet-4",
    inputTokens: 1000,
    outputTokens: 500,
    success: true,
  };

  const pricingMap = new Map<string, ModelPricing>([["anthropic/claude-sonnet-4", samplePricing]]);

  const events: UsageEvent[] = [
    {
      id: "evt-1",
      type: "llm-call",
      timestamp: "2026-01-15T10:00:00Z",
      attribution: {
        userId: "user-1",
        teamId: "team-a",
        projectId: "project-a",
        skillId: "acme/code-review",
      },
      data: sampleLlmUsage,
    },
    {
      id: "evt-2",
      type: "llm-call",
      timestamp: "2026-01-15T11:00:00Z",
      attribution: {
        userId: "user-2",
        teamId: "team-a",
        projectId: "project-a",
        skillId: "acme/security-audit",
      },
      data: { ...sampleLlmUsage, inputTokens: 2000, outputTokens: 1000 },
    },
    {
      id: "evt-3",
      type: "skill-invocation",
      timestamp: "2026-01-15T12:00:00Z",
      attribution: { userId: "user-1", skillId: "acme/code-review" },
      data: { skillId: "acme/code-review", version: "1.0.0", success: true },
    },
  ];

  describe("calculateLlmCost", () => {
    it("calculates basic input/output cost", () => {
      const cost = calculateLlmCost(sampleLlmUsage, samplePricing);
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it("includes cache costs when present", () => {
      const usageWithCache: LlmUsage = {
        ...sampleLlmUsage,
        cacheReadTokens: 500,
        cacheWriteTokens: 200,
      };
      const cost = calculateLlmCost(usageWithCache, samplePricing);
      expect(cost).toBeCloseTo(0.0114, 6);
    });

    it("returns 0 for zero tokens", () => {
      const zeroUsage: LlmUsage = {
        ...sampleLlmUsage,
        inputTokens: 0,
        outputTokens: 0,
      };
      const cost = calculateLlmCost(zeroUsage, samplePricing);
      expect(cost).toBe(0);
    });
  });

  describe("isCostCapExceeded", () => {
    const cap: CostCap = {
      id: "cap-1",
      name: "Daily Cap",
      maxAmount: 100,
      period: "daily",
      scope: { teamId: "team-a" },
      action: "block",
      enabled: true,
    };

    it("returns true when cost exceeds cap", () => {
      expect(isCostCapExceeded(150, cap)).toBe(true);
    });

    it("returns true when cost equals cap", () => {
      expect(isCostCapExceeded(100, cap)).toBe(true);
    });

    it("returns false when cost below cap", () => {
      expect(isCostCapExceeded(50, cap)).toBe(false);
    });

    it("returns false when cap is disabled", () => {
      const disabledCap = { ...cap, enabled: false };
      expect(isCostCapExceeded(150, disabledCap)).toBe(false);
    });

    it("only evaluates matching attribution scope when provided", () => {
      expect(isCostCapExceeded(150, cap, { teamId: "team-a", projectId: "project-1" })).toBe(true);
      expect(isCostCapExceeded(150, cap, { teamId: "team-b", projectId: "project-1" })).toBe(false);
    });

    it("evaluates policy action for enforcement semantics", () => {
      const warnDecision = evaluateCostCap(150, { ...cap, action: "warn" }, { teamId: "team-a" });
      expect(warnDecision.exceeded).toBe(true);
      expect(warnDecision.shouldEnforce).toBe(false);

      const blockDecision = evaluateCostCap(150, { ...cap, action: "block" }, { teamId: "team-a" });
      expect(blockDecision.exceeded).toBe(true);
      expect(blockDecision.shouldEnforce).toBe(true);
      expect(blockDecision.action).toBe("block");
    });

    it("matches cap scope across all configured dimensions", () => {
      expect(
        matchesCostCapScope(
          { teamId: "team-a", projectId: "project-a" },
          { teamId: "team-a", projectId: "project-a", userId: "user-1" },
        ),
      ).toBe(true);

      expect(
        matchesCostCapScope(
          { teamId: "team-a", projectId: "project-a" },
          { teamId: "team-a", projectId: "project-b" },
        ),
      ).toBe(false);
    });
  });

  describe("shouldFireAlert", () => {
    const alert: BudgetAlert = {
      id: "alert-1",
      name: "High Usage Alert",
      threshold: 80,
      period: "monthly",
      recipients: ["admin@example.com"],
      enabled: true,
      channels: ["email"],
    };

    it("returns true when cost exceeds threshold", () => {
      expect(shouldFireAlert(100, alert)).toBe(true);
    });

    it("returns true when cost equals threshold", () => {
      expect(shouldFireAlert(80, alert)).toBe(true);
    });

    it("returns false when cost below threshold", () => {
      expect(shouldFireAlert(50, alert)).toBe(false);
    });

    it("returns false when alert is disabled", () => {
      const disabledAlert = { ...alert, enabled: false };
      expect(shouldFireAlert(100, disabledAlert)).toBe(false);
    });

    it("supports percentage-based thresholds against configured budget", () => {
      const percentageAlert: BudgetAlert = {
        id: "alert-2",
        name: "Budget Percent Alert",
        budget: 200,
        percentages: [75, 90, 100],
        period: "monthly",
        recipients: ["finance@example.com"],
        enabled: true,
        channels: ["email", "slack"],
      };

      expect(shouldFireAlert(149, percentageAlert)).toBe(false);
      expect(shouldFireAlert(150, percentageAlert)).toBe(true);
    });

    it("supports projected spend alerts using current spend rate", () => {
      const projectedAlert: BudgetAlert = {
        id: "alert-3",
        name: "Projected Overrun Alert",
        budget: 100,
        percentages: [100],
        projected: true,
        period: "monthly",
        recipients: ["ops@example.com"],
        enabled: true,
        channels: ["email"],
      };

      // $10 spent in first 10% of period projects to $100 total by period end.
      expect(shouldFireAlert(10, projectedAlert, { elapsedMs: 10, periodMs: 100 })).toBe(true);
    });

    it("projects period cost from spend rate", () => {
      expect(projectPeriodCost(10, 10, 100)).toBe(100);
      expect(projectPeriodCost(10, 0, 100)).toBe(10);
    });

    it("validates attribution dimension + value pairing", () => {
      expect(
        BudgetAlertSchema.safeParse({
          id: "alert-4",
          name: "Team Budget Alert",
          budget: 100,
          percentages: [100],
          period: "monthly",
          recipients: ["ops@example.com"],
          enabled: true,
          channels: ["email", "slack"],
          attributionDimension: "teamId",
          attributionValue: "team-1",
        }).success,
      ).toBe(true);

      expect(
        BudgetAlertSchema.safeParse({
          id: "alert-5",
          name: "Invalid Team Alert",
          budget: 100,
          percentages: [100],
          period: "monthly",
          recipients: ["ops@example.com"],
          enabled: true,
          channels: ["email"],
          attributionDimension: "teamId",
        }).success,
      ).toBe(false);
    });
  });

  describe("attribution aggregation", () => {
    it("aggregates by single dimension", () => {
      const byTeam = aggregateUsageByAttribution(events, "teamId", pricingMap);
      expect(byTeam[0]?.value).toBe("team-a");
      expect(byTeam[0]?.eventCount).toBe(2);
      expect(byTeam[0]?.totalCost).toBeCloseTo(0.0315, 4);
    });

    it("aggregates by combined dimensions", () => {
      const combined = aggregateUsageByAttributions(
        events,
        ["teamId", "projectId", "developerId"],
        pricingMap,
      );
      expect(combined).toHaveLength(3);
      expect(combined.some((entry) => entry.dimensions.teamId === "team-a")).toBe(true);
    });

    it("provides per-dimension helper utilities", () => {
      expect(aggregateUsageByDeveloper(events, pricingMap).length).toBeGreaterThan(0);
      expect(aggregateUsageByTeam(events, pricingMap).length).toBeGreaterThan(0);
      expect(aggregateUsageByProject(events, pricingMap).length).toBeGreaterThan(0);
      expect(aggregateUsageBySkill(events, pricingMap).length).toBeGreaterThan(0);
    });
  });

  describe("aggregateSkillCostAttribution", () => {
    it("returns per-skill tokens and costs ranked by cost", () => {
      const report = aggregateSkillCostAttribution(events, pricingMap);

      expect(report[0]).toMatchObject({
        skillId: "acme/security-audit",
        totalTokens: 3000,
      });
      expect(report[0]?.totalCost).toBeCloseTo(0.021, 6);

      expect(report[1]).toMatchObject({
        skillId: "acme/code-review",
        totalTokens: 1500,
      });
      expect(report[1]?.totalCost).toBeCloseTo(0.0105, 6);
    });
  });

  describe("aggregateUsage", () => {
    it("aggregates costs by type", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.byType["llm-call"]).toBeGreaterThan(0);
      expect(summary.byType["skill-invocation"]).toBeDefined();
    });

    it("aggregates costs by provider", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.byProvider?.["anthropic"]).toBeGreaterThan(0);
    });

    it("attributes llm costs by skill", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.bySkill?.["acme/security-audit"]).toBeCloseTo(0.021, 6);
      expect(summary.bySkill?.["acme/code-review"]).toBeCloseTo(0.0105, 6);
    });

    it("aggregates token counts", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.tokenCounts?.input).toBe(3000);
      expect(summary.tokenCounts?.output).toBe(1500);
    });

    it("calculates total cost", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.totalCost).toBeCloseTo(0.0315, 4);
    });

    it("sets period boundaries", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      expect(summary.periodStart).toBe("2026-01-15");
      expect(summary.periodEnd).toBe("2026-01-16");
    });
  });

  describe("exportCostSummary", () => {
    it("exports cost summary as JSON", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      const json = exportCostSummary(summary, { format: "json" });
      const parsed = JSON.parse(json) as Array<Record<string, unknown>>;

      expect(parsed[0]?.["dimension"]).toBe("total");
      expect(parsed[0]?.["key"]).toBe("totalCost");
      expect(
        parsed.some((row) => row["dimension"] === "byProvider" && row["key"] === "anthropic"),
      ).toBe(true);
    });

    it("exports cost summary as CSV", () => {
      const summary = aggregateUsage(events, pricingMap, "2026-01-15", "2026-01-16");
      const csv = exportCostSummary(summary, { format: "csv" });
      const lines = csv.split("\n");

      expect(lines[0]).toBe("periodStart,periodEnd,currency,dimension,key,cost");
      expect(lines.some((line) => line.includes(",byType,llm-call,"))).toBe(true);
    });
  });
});
