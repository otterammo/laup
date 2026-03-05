import { describe, expect, it, vi } from "vitest";
import {
  AwsCostExplorerConnector,
  AzureCostManagementConnector,
  CloudBillingSyncService,
  GcpBillingConnector,
  InMemoryInfrastructureCostStorage,
} from "../cloud-billing.js";

describe("cloud-billing", () => {
  it("normalizes component attribution from provider tags", async () => {
    const connector = new AwsCostExplorerConnector(async () => [
      {
        id: "aws-1",
        provider: "aws",
        componentId: "fallback-component",
        service: "ec2",
        startTime: "2026-03-01T00:00:00.000Z",
        endTime: "2026-03-02T00:00:00.000Z",
        amount: 5,
        currency: "USD",
        tags: {
          "laup:component": "api",
        },
      },
    ]);

    const costs = await connector.fetchCosts({
      startTime: new Date("2026-03-01T00:00:00.000Z"),
      endTime: new Date("2026-03-02T00:00:00.000Z"),
    });

    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({
      provider: "aws",
      componentId: "api",
    });
  });

  it("runs sync across aws, gcp, and azure with daily default schedule", async () => {
    let now = new Date("2026-03-05T12:00:00.000Z");
    const storage = new InMemoryInfrastructureCostStorage();
    let counter = 0;
    const fetchSpy = vi.fn(async () => {
      counter += 1;
      return [
        {
          id: `rec-${counter}`,
          provider: "aws" as const,
          componentId: "gateway",
          service: "compute",
          startTime: "2026-03-04T00:00:00.000Z",
          endTime: "2026-03-05T00:00:00.000Z",
          amount: 1,
          currency: "USD",
          tags: {},
        },
      ];
    });

    const service = new CloudBillingSyncService({
      connectors: [
        new AwsCostExplorerConnector(fetchSpy),
        new GcpBillingConnector(fetchSpy),
        new AzureCostManagementConnector(fetchSpy),
      ],
      storage,
      now: () => now,
    });

    expect(service.isSyncDue()).toBe(true);

    const first = await service.runScheduledSync();
    expect(first).not.toBeNull();
    expect(first?.recordsSynced).toBe(3);
    expect(first?.perProvider).toEqual({ aws: 1, gcp: 1, azure: 1 });

    expect(service.isSyncDue()).toBe(false);
    expect(await service.runScheduledSync()).toBeNull();

    now = new Date("2026-03-06T12:00:01.000Z");
    expect(service.isSyncDue()).toBe(true);
    await service.runScheduledSync();

    expect(fetchSpy).toHaveBeenCalledTimes(6);
    const stored = await storage.query({
      startTime: new Date("2026-03-01T00:00:00.000Z"),
      endTime: new Date("2026-03-07T00:00:00.000Z"),
    });
    expect(stored.length).toBeGreaterThanOrEqual(3);
  });
});
