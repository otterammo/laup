import { describe, expect, it } from "vitest";
import { CostAttributionReportService } from "../cost-attribution-report.js";
import type { UsageEvent } from "../cost-schema.js";
import { InMemoryPricingProvider } from "../pricing-provider.js";
import { InMemoryUsageStorage } from "../usage-storage.js";

describe("CostAttributionReportService", () => {
  it("generates per-skill token + cost report filtered by range, project, and team", async () => {
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
      createLlmEvent("evt-1", "2026-03-01T10:00:00.000Z", {
        skillId: "acme/review",
        teamId: "team-1",
        projectId: "proj-1",
        inputTokens: 1_000,
        outputTokens: 1_000,
      }),
    );
    await usageStorage.store(
      createLlmEvent("evt-2", "2026-03-01T10:05:00.000Z", {
        skillId: "acme/plan",
        teamId: "team-1",
        projectId: "proj-1",
        inputTokens: 500,
        outputTokens: 500,
      }),
    );

    await usageStorage.store(
      createLlmEvent("evt-3", "2026-03-02T10:00:00.000Z", {
        skillId: "acme/review",
        teamId: "team-2",
        projectId: "proj-1",
        inputTokens: 10_000,
        outputTokens: 10_000,
      }),
    );

    const service = new CostAttributionReportService({
      usageStorage,
      pricingProvider,
      now: () => new Date("2026-03-03T00:00:00.000Z"),
    });

    const report = await service.generateSkillCostReport({
      startTime: new Date("2026-03-01T00:00:00.000Z"),
      endTime: new Date("2026-03-02T00:00:00.000Z"),
      teamId: "team-1",
      projectId: "proj-1",
    });

    expect(report.skills.map((skill) => skill.skillId)).toEqual(["acme/review", "acme/plan"]);

    expect(report.skills[0]).toMatchObject({
      skillId: "acme/review",
      totalTokens: 2_000,
    });
    expect(report.skills[0]?.totalCost).toBeCloseTo(0.003, 8);

    expect(report.skills[1]).toMatchObject({
      skillId: "acme/plan",
      totalTokens: 1_000,
    });
    expect(report.skills[1]?.totalCost).toBeCloseTo(0.0015, 8);
  });
});

function createLlmEvent(
  id: string,
  timestamp: string,
  input: {
    skillId: string;
    teamId: string;
    projectId: string;
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
      skillId: input.skillId,
      teamId: input.teamId,
      projectId: input.projectId,
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
