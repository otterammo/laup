import { describe, expect, it } from "vitest";
import {
  createMarketplaceApiHandler,
  InMemorySkillMarketplace,
  type MarketplaceSkill,
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
  });
});
