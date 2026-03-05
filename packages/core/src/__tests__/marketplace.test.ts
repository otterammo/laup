import { describe, expect, it } from "vitest";
import {
  createMarketplaceApiHandler,
  InMemoryMarketplaceSkillAnalytics,
  InMemorySkillMarketplace,
  type MarketplaceSkill,
  renderMarketplaceAuthorAnalyticsPage,
  renderMarketplacePage,
} from "../marketplace.js";

const sampleSkills: MarketplaceSkill[] = [
  {
    id: "acme/weather",
    name: "Weather Assistant",
    description: "Forecasts and severe weather alerts.",
    author: "acme",
    latestVersion: "1.2.0",
    tags: ["weather", "alerts"],
    visibility: "public",
    downloads: 5000,
    rating: 4.6,
    updatedAt: "2026-02-20T00:00:00.000Z",
    verified: true,
  },
  {
    id: "acme/calendar",
    name: "Calendar Assistant",
    description: "Event planning and reminders.",
    author: "acme",
    latestVersion: "2.1.0",
    tags: ["calendar", "productivity"],
    visibility: "team-private",
    downloads: 2100,
    rating: 4.2,
    updatedAt: "2026-02-18T00:00:00.000Z",
  },
  {
    id: "labs/release-notes",
    name: "Release Notes",
    description: "Generate changelog summaries.",
    author: "labs",
    latestVersion: "0.9.1",
    tags: ["devrel", "automation"],
    visibility: "public",
    downloads: 900,
    rating: 4.8,
    updatedAt: "2026-02-22T00:00:00.000Z",
  },
];

function makeMarketplace(): InMemorySkillMarketplace {
  const marketplace = new InMemorySkillMarketplace();
  marketplace.registerMany(sampleSkills);
  return marketplace;
}

describe("marketplace", () => {
  describe("InMemorySkillMarketplace", () => {
    it("filters by search and tags", async () => {
      const marketplace = makeMarketplace();
      const result = await marketplace.list({ search: "weather", tags: ["alerts"] });

      expect(result.total).toBe(1);
      expect(result.skills[0]?.id).toBe("acme/weather");
    });

    it("sorts by rating ascending", async () => {
      const marketplace = makeMarketplace();
      const result = await marketplace.list({ sortBy: "rating", sortOrder: "asc" });

      expect(result.skills.map((skill) => skill.id)).toEqual([
        "acme/calendar",
        "acme/weather",
        "labs/release-notes",
      ]);
    });

    it("applies pagination bounds", async () => {
      const marketplace = makeMarketplace();
      const result = await marketplace.list({ limit: 1, offset: 1, sortBy: "downloads" });

      expect(result.total).toBe(3);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]?.id).toBe("acme/calendar");
    });
  });

  describe("author analytics", () => {
    it("aggregates installs, invocation frequency, and parameter usage", async () => {
      const marketplace = makeMarketplace();
      const analytics = new InMemoryMarketplaceSkillAnalytics(
        marketplace,
        () => new Date("2026-03-01T12:00:00.000Z"),
      );

      await analytics.recordInstall({
        skillId: "acme/weather",
        version: "1.0.0",
        timestamp: "2026-02-01T01:00:00.000Z",
      });
      await analytics.recordInstall({
        skillId: "acme/weather",
        version: "1.2.0",
        timestamp: "2026-02-02T01:00:00.000Z",
      });
      await analytics.recordInstall({
        skillId: "acme/calendar",
        version: "2.1.0",
        timestamp: "2026-02-02T05:00:00.000Z",
      });
      await analytics.recordInstall({
        skillId: "labs/release-notes",
        version: "0.9.1",
        timestamp: "2026-02-03T05:00:00.000Z",
      });

      await analytics.recordInvocation({
        skillId: "acme/weather",
        invocationCount: 3,
        parameters: { location: "Austin", units: "metric" },
        defaultParameters: ["units"],
        timestamp: "2026-02-02T01:00:00.000Z",
      });
      await analytics.recordInvocation({
        skillId: "acme/calendar",
        invocationCount: 2,
        parameters: { timezone: "America/Chicago" },
        timestamp: "2026-02-10T01:00:00.000Z",
      });
      await analytics.recordInvocation({
        skillId: "labs/release-notes",
        invocationCount: 10,
        parameters: { format: "markdown" },
        timestamp: "2026-02-10T01:00:00.000Z",
      });

      const report = await analytics.getAuthorAnalytics("acme", { interval: "weekly" });

      expect(report.installs.byVersion).toEqual([
        { version: "1.0.0", count: 1 },
        { version: "1.2.0", count: 1 },
        { version: "2.1.0", count: 1 },
      ]);
      expect(report.installs.overTime).toEqual([
        { periodStart: "2026-01-26T00:00:00.000Z", count: 1 },
        { periodStart: "2026-02-02T00:00:00.000Z", count: 2 },
      ]);

      expect(report.invocations.total).toBe(5);
      expect(report.invocations.frequency).toEqual([
        { periodStart: "2026-02-02T00:00:00.000Z", count: 3 },
        { periodStart: "2026-02-09T00:00:00.000Z", count: 2 },
      ]);

      expect(report.parameterUsage).toEqual([
        { parameter: "location", usedCount: 3, defaultUsedCount: 0, overriddenCount: 3 },
        { parameter: "units", usedCount: 3, defaultUsedCount: 3, overriddenCount: 0 },
        { parameter: "timezone", usedCount: 2, defaultUsedCount: 0, overriddenCount: 2 },
      ]);
    });
  });

  describe("API handler", () => {
    it("returns skill listing from GET /skills", async () => {
      const marketplace = makeMarketplace();
      const handler = createMarketplaceApiHandler({ marketplace });

      const response = await handler({
        method: "GET",
        path: "/api/marketplace/skills",
        query: { visibility: "public", sortBy: "rating", sortOrder: "desc" },
      });

      expect(response.status).toBe(200);
      const payload = JSON.parse(response.body) as { total: number; skills: MarketplaceSkill[] };
      expect(payload.total).toBe(2);
      expect(payload.skills[0]?.id).toBe("labs/release-notes");
    });

    it("returns individual skill by encoded id", async () => {
      const marketplace = makeMarketplace();
      const handler = createMarketplaceApiHandler({ marketplace });

      const response = await handler({
        method: "GET",
        path: "/api/marketplace/skills/acme%2Fweather",
      });

      expect(response.status).toBe(200);
      const payload = JSON.parse(response.body) as MarketplaceSkill;
      expect(payload.id).toBe("acme/weather");
    });

    it("returns author analytics via API and dashboard", async () => {
      const marketplace = makeMarketplace();
      const analytics = new InMemoryMarketplaceSkillAnalytics(
        marketplace,
        () => new Date("2026-03-01T12:00:00.000Z"),
      );
      await analytics.recordInstall({
        skillId: "acme/weather",
        version: "1.2.0",
        timestamp: "2026-02-02T01:00:00.000Z",
      });
      await analytics.recordInvocation({
        skillId: "acme/weather",
        invocationCount: 4,
        parameters: { location: "Austin" },
        timestamp: "2026-02-02T01:00:00.000Z",
      });

      const handler = createMarketplaceApiHandler({ marketplace, analytics });

      const apiResponse = await handler({
        method: "GET",
        path: "/api/marketplace/authors/acme/analytics",
        query: { interval: "daily" },
      });

      expect(apiResponse.status).toBe(200);
      const payload = JSON.parse(apiResponse.body) as {
        author: string;
        invocations: { total: number };
      };
      expect(payload.author).toBe("acme");
      expect(payload.invocations.total).toBe(4);

      const dashboardResponse = await handler({
        method: "GET",
        path: "/api/marketplace/authors/acme/analytics/dashboard",
      });

      expect(dashboardResponse.status).toBe(200);
      expect(dashboardResponse.headers["content-type"]).toContain("text/html");
      expect(dashboardResponse.body).toContain("Skill Analytics · acme");
      expect(dashboardResponse.body).toContain("Total invocations: 4");
    });

    it("rejects unsupported methods", async () => {
      const marketplace = makeMarketplace();
      const handler = createMarketplaceApiHandler({ marketplace });

      const response = await handler({ method: "POST", path: "/api/marketplace/skills" });
      expect(response.status).toBe(405);
    });
  });

  describe("web UI", () => {
    it("renders HTML page with skill metadata", async () => {
      const html = await renderMarketplacePage({ marketplace: makeMarketplace() }, { limit: 2 });

      expect(html).toContain("<h1>Skill Marketplace</h1>");
      expect(html).toContain("Weather Assistant");
      expect(html).toContain("Showing 2 of 3 skills.");
    });

    it("renders analytics dashboard page", async () => {
      const marketplace = makeMarketplace();
      const analytics = new InMemoryMarketplaceSkillAnalytics(
        marketplace,
        () => new Date("2026-03-01T12:00:00.000Z"),
      );
      await analytics.recordInstall({
        skillId: "acme/weather",
        version: "1.2.0",
        timestamp: "2026-02-02T01:00:00.000Z",
      });

      const html = await renderMarketplaceAuthorAnalyticsPage({ marketplace, analytics }, "acme", {
        interval: "monthly",
      });

      expect(html).toContain("Skill Analytics · acme");
      expect(html).toContain("Installation counts");
      expect(html).toContain("Per version");
    });
  });
});
