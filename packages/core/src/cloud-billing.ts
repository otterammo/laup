import { z } from "zod";

export const CloudBillingProviderSchema = z.enum(["aws", "gcp", "azure"]);
export type CloudBillingProvider = z.infer<typeof CloudBillingProviderSchema>;

export const InfrastructureCostRecordSchema = z.object({
  id: z.string().min(1),
  provider: CloudBillingProviderSchema,
  componentId: z.string().min(1),
  service: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  amount: z.number().nonnegative(),
  currency: z.string().default("USD"),
  tags: z.record(z.string(), z.string()).default({}),
});

export type InfrastructureCostRecord = z.infer<typeof InfrastructureCostRecordSchema>;

export interface InfrastructureCostStorage {
  upsert(records: InfrastructureCostRecord[]): Promise<void>;
  query(range: { startTime: Date; endTime: Date }): Promise<InfrastructureCostRecord[]>;
}

export class InMemoryInfrastructureCostStorage implements InfrastructureCostStorage {
  private readonly records = new Map<string, InfrastructureCostRecord>();

  async upsert(records: InfrastructureCostRecord[]): Promise<void> {
    for (const record of records) {
      const parsed = InfrastructureCostRecordSchema.parse(record);
      this.records.set(parsed.id, parsed);
    }
  }

  async query(range: { startTime: Date; endTime: Date }): Promise<InfrastructureCostRecord[]> {
    const start = range.startTime.getTime();
    const end = range.endTime.getTime();

    return Array.from(this.records.values()).filter((record) => {
      const recordStart = Date.parse(record.startTime);
      const recordEnd = Date.parse(record.endTime);
      return recordEnd > start && recordStart < end;
    });
  }
}

export interface CloudBillingConnector {
  readonly provider: CloudBillingProvider;
  fetchCosts(range: { startTime: Date; endTime: Date }): Promise<InfrastructureCostRecord[]>;
}

interface ConnectorConfig {
  componentTagKey?: string;
}

type ConnectorFetcher = (range: {
  startTime: Date;
  endTime: Date;
}) => Promise<InfrastructureCostRecord[]>;

abstract class BaseCloudBillingConnector implements CloudBillingConnector {
  abstract readonly provider: CloudBillingProvider;
  private readonly componentTagKey: string;

  constructor(
    private readonly fetcher: ConnectorFetcher,
    config: ConnectorConfig = {},
  ) {
    this.componentTagKey = config.componentTagKey ?? "laup:component";
  }

  async fetchCosts(range: { startTime: Date; endTime: Date }): Promise<InfrastructureCostRecord[]> {
    const raw = await this.fetcher(range);

    return raw.map((record) => {
      const parsed = InfrastructureCostRecordSchema.parse(record);
      const componentId = parsed.tags[this.componentTagKey] ?? parsed.componentId;

      return InfrastructureCostRecordSchema.parse({
        ...parsed,
        provider: this.provider,
        componentId,
      });
    });
  }
}

export class AwsCostExplorerConnector extends BaseCloudBillingConnector {
  readonly provider = "aws" as const;
}

export class GcpBillingConnector extends BaseCloudBillingConnector {
  readonly provider = "gcp" as const;
}

export class AzureCostManagementConnector extends BaseCloudBillingConnector {
  readonly provider = "azure" as const;
}

export const CloudBillingSyncScheduleSchema = z.object({
  intervalMs: z
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60_000),
  lookbackMs: z
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60_000),
});

export type CloudBillingSyncSchedule = z.infer<typeof CloudBillingSyncScheduleSchema>;

export interface CloudBillingSyncConfig {
  connectors: CloudBillingConnector[];
  storage: InfrastructureCostStorage;
  schedule?: Partial<CloudBillingSyncSchedule>;
  now?: () => Date;
}

export interface CloudBillingSyncResult {
  syncedAt: string;
  recordsSynced: number;
  perProvider: Record<CloudBillingProvider, number>;
  range: {
    startTime: string;
    endTime: string;
  };
}

export class CloudBillingSyncService {
  private readonly schedule: CloudBillingSyncSchedule;
  private readonly now: () => Date;
  private lastSyncedAt: Date | null = null;

  constructor(private readonly config: CloudBillingSyncConfig) {
    this.schedule = CloudBillingSyncScheduleSchema.parse(config.schedule ?? {});
    this.now = config.now ?? (() => new Date());
  }

  async runSync(range?: { startTime: Date; endTime: Date }): Promise<CloudBillingSyncResult> {
    const endTime = range?.endTime ?? this.now();
    const startTime = range?.startTime ?? new Date(endTime.getTime() - this.schedule.lookbackMs);

    const perProvider: Record<CloudBillingProvider, number> = { aws: 0, gcp: 0, azure: 0 };
    const allRecords: InfrastructureCostRecord[] = [];

    for (const connector of this.config.connectors) {
      const costs = await connector.fetchCosts({ startTime, endTime });
      allRecords.push(...costs);
      perProvider[connector.provider] += costs.length;
    }

    await this.config.storage.upsert(allRecords);
    this.lastSyncedAt = endTime;

    return {
      syncedAt: endTime.toISOString(),
      recordsSynced: allRecords.length,
      perProvider,
      range: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      },
    };
  }

  isSyncDue(): boolean {
    if (!this.lastSyncedAt) {
      return true;
    }

    return this.now().getTime() - this.lastSyncedAt.getTime() >= this.schedule.intervalMs;
  }

  async runScheduledSync(): Promise<CloudBillingSyncResult | null> {
    if (!this.isSyncDue()) {
      return null;
    }

    return this.runSync();
  }
}

export function createCloudBillingSyncService(
  config: CloudBillingSyncConfig,
): CloudBillingSyncService {
  return new CloudBillingSyncService(config);
}
