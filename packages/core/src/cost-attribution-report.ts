import { aggregateSkillCostAttribution, type SkillCostAttribution } from "./cost-schema.js";
import type { PricingProvider } from "./pricing-provider.js";
import type { UsageQueryFilter, UsageStorage } from "./usage-storage.js";

export interface SkillCostAttributionFilter {
  startTime?: Date;
  endTime?: Date;
  teamId?: string;
  projectId?: string;
}

export interface SkillCostAttributionReport {
  generatedAt: string;
  filter: SkillCostAttributionFilter;
  skills: SkillCostAttribution[];
}

export interface CostAttributionReportServiceConfig {
  usageStorage: UsageStorage;
  pricingProvider: PricingProvider;
  now?: () => Date;
}

export class CostAttributionReportService {
  private readonly now: () => Date;

  constructor(private readonly config: CostAttributionReportServiceConfig) {
    this.now = config.now ?? (() => new Date());
  }

  async generateSkillCostReport(
    filter: SkillCostAttributionFilter = {},
  ): Promise<SkillCostAttributionReport> {
    const endTime = filter.endTime ?? this.now();
    const queryFilter: UsageQueryFilter = {
      endTime,
      ...(filter.startTime ? { startTime: filter.startTime } : {}),
      ...(filter.teamId ? { teamId: filter.teamId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
    };

    const events = await queryAllEvents(this.config.usageStorage, queryFilter);
    const pricingMap = new Map(
      (await this.config.pricingProvider.getAllPricing()).map((price) => [
        `${price.provider}/${price.model}`,
        price,
      ]),
    );

    return {
      generatedAt: endTime.toISOString(),
      filter,
      skills: aggregateSkillCostAttribution(events, pricingMap),
    };
  }
}

export function createCostAttributionReportService(
  config: CostAttributionReportServiceConfig,
): CostAttributionReportService {
  return new CostAttributionReportService(config);
}

async function queryAllEvents(usageStorage: UsageStorage, filter: UsageQueryFilter) {
  const pageSize = 500;
  let offset = 0;
  const events: Awaited<ReturnType<UsageStorage["query"]>>["data"] = [];

  while (true) {
    const page = await usageStorage.query(filter, { limit: pageSize, offset });
    events.push(...page.data);

    if (!page.hasMore) {
      break;
    }

    offset += pageSize;
  }

  return events;
}
