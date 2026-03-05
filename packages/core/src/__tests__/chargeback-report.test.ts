import { describe, expect, it } from "vitest";
import {
  type ChargebackMappingRule,
  ChargebackReportService,
  exportChargebackReport,
} from "../chargeback-report.js";
import type { UsageEvent } from "../cost-schema.js";
import { InMemoryPricingProvider } from "../pricing-provider.js";
import { InMemoryUsageStorage } from "../usage-storage.js";

describe("ChargebackReportService", () => {
  it("allocates costs to configurable cost centers with team/project/custom mappings", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const pricingProvider = new InMemoryPricingProvider({
      initialPricing: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          inputCostPerMillion: 1,
          outputCostPerMillion: 2,
          effectiveDate: "2026-01-01",
          currency: "USD",
        },
      ],
    });

    await usageStorage.store(
      createLlmEvent("evt-1", "2026-03-05T10:00:00.000Z", {
        teamId: "team-eng",
        projectId: "proj-platform",
        inputTokens: 1_000,
        outputTokens: 1_000,
      }),
    );

    await usageStorage.store(
      createLlmEvent("evt-2", "2026-03-06T10:00:00.000Z", {
        teamId: "team-fin",
        projectId: "proj-finance",
        inputTokens: 2_000,
        outputTokens: 1_000,
      }),
    );

    await usageStorage.store(
      createLlmEvent("evt-3", "2026-03-07T10:00:00.000Z", {
        teamId: "team-mkt",
        projectId: "proj-marketing",
        orgId: "marketing",
        inputTokens: 500,
        outputTokens: 500,
      }),
    );

    const mappings: ChargebackMappingRule[] = [
      {
        costCenter: "CC-ENG",
        groupType: "team",
        groupId: "team-eng",
        groupName: "Engineering",
        match: { teamId: "team-eng" },
      },
      {
        costCenter: "CC-FIN",
        groupType: "project",
        groupId: "proj-finance",
        groupName: "Finance Platform",
        match: { projectId: "proj-finance" },
      },
      {
        costCenter: "CC-MKT-CAMPAIGN",
        groupType: "custom",
        groupId: "brand-awareness",
        groupName: "Brand Awareness",
        match: { orgId: "marketing" },
      },
    ];

    const service = new ChargebackReportService({
      usageStorage,
      pricingProvider,
      now: () => new Date("2026-03-10T00:00:00.000Z"),
    });

    const report = await service.generate({ mappings });

    expect(report.billingPeriod).toEqual({
      startTime: "2026-03-01T00:00:00.000Z",
      endTime: "2026-04-01T00:00:00.000Z",
      granularity: "month",
    });

    expect(report.rows).toHaveLength(3);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          costCenter: "CC-ENG",
          groupType: "team",
          groupId: "team-eng",
          totalCost: expect.closeTo(0.003, 8),
        }),
        expect.objectContaining({
          costCenter: "CC-FIN",
          groupType: "project",
          groupId: "proj-finance",
          totalCost: expect.closeTo(0.004, 8),
        }),
        expect.objectContaining({
          costCenter: "CC-MKT-CAMPAIGN",
          groupType: "custom",
          groupId: "brand-awareness",
          totalCost: expect.closeTo(0.0015, 8),
        }),
      ]),
    );
  });

  it("exports chargeback report to CSV and JSON", async () => {
    const usageStorage = new InMemoryUsageStorage();
    await usageStorage.init();

    const pricingProvider = new InMemoryPricingProvider({
      initialPricing: [
        {
          provider: "openai",
          model: "gpt-4o-mini",
          inputCostPerMillion: 1,
          outputCostPerMillion: 2,
          effectiveDate: "2026-01-01",
          currency: "USD",
        },
      ],
    });

    await usageStorage.store(
      createLlmEvent("evt-4", "2026-02-01T12:00:00.000Z", {
        teamId: "team-fin",
        projectId: "proj-finance",
        costCenter: "CC-FIN",
        inputTokens: 1_000,
        outputTokens: 1_000,
      }),
    );

    const service = new ChargebackReportService({
      usageStorage,
      pricingProvider,
      now: () => new Date("2026-02-20T00:00:00.000Z"),
    });

    const report = await service.generate({
      billingPeriod: {
        startTime: new Date("2026-02-01T00:00:00.000Z"),
        endTime: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    const json = exportChargebackReport(report, { format: "json" });
    const csv = exportChargebackReport(report, { format: "csv" });

    expect(() => JSON.parse(json)).not.toThrow();
    expect(csv).toContain("periodStart,periodEnd,costCenter,groupType,groupId");
    expect(csv).toContain("CC-FIN,costCenter,CC-FIN");
  });
});

function createLlmEvent(
  id: string,
  timestamp: string,
  input: {
    teamId: string;
    projectId: string;
    orgId?: string;
    costCenter?: string;
    inputTokens: number;
    outputTokens: number;
  },
): UsageEvent {
  return {
    id,
    timestamp,
    type: "llm-call",
    attribution: {
      developerId: "dev-1",
      teamId: input.teamId,
      projectId: input.projectId,
      orgId: input.orgId,
      costCenter: input.costCenter,
    },
    data: {
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      success: true,
    },
  };
}
