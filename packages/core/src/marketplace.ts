/**
 * Skill marketplace interface via API and web UI (SKILL-005).
 */

import type { SkillVisibility } from "./skill-schema.js";

export type MarketplaceSortBy = "name" | "downloads" | "rating" | "updatedAt";
export type MarketplaceSortOrder = "asc" | "desc";

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  latestVersion: string;
  tags: string[];
  visibility: SkillVisibility;
  downloads: number;
  rating: number;
  updatedAt: string;
  verified?: boolean;
}

export interface MarketplaceQuery {
  search?: string;
  tags?: string[];
  visibility?: SkillVisibility;
  sortBy?: MarketplaceSortBy;
  sortOrder?: MarketplaceSortOrder;
  limit?: number;
  offset?: number;
}

export interface MarketplacePage {
  skills: MarketplaceSkill[];
  total: number;
  limit: number;
  offset: number;
}

export interface SkillMarketplace {
  list(query?: MarketplaceQuery): Promise<MarketplacePage>;
  get(id: string): Promise<MarketplaceSkill | null>;
}

export class InMemorySkillMarketplace implements SkillMarketplace {
  private readonly skills = new Map<string, MarketplaceSkill>();

  register(skill: MarketplaceSkill): void {
    this.skills.set(skill.id, skill);
  }

  registerMany(skills: MarketplaceSkill[]): void {
    for (const skill of skills) this.register(skill);
  }

  async get(id: string): Promise<MarketplaceSkill | null> {
    return this.skills.get(id) ?? null;
  }

  async list(query: MarketplaceQuery = {}): Promise<MarketplacePage> {
    const limit = clampInt(query.limit ?? 25, 1, 100);
    const offset = Math.max(0, query.offset ?? 0);

    const normalizedSearch = query.search?.trim().toLowerCase();
    const normalizedTags = query.tags?.map((tag) => tag.trim().toLowerCase()).filter(Boolean) ?? [];

    const filtered = Array.from(this.skills.values()).filter((skill) => {
      if (query.visibility && skill.visibility !== query.visibility) return false;

      if (normalizedSearch) {
        const haystack =
          `${skill.id} ${skill.name} ${skill.description} ${skill.author}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) return false;
      }

      if (normalizedTags.length > 0) {
        const skillTags = new Set(skill.tags.map((tag) => tag.toLowerCase()));
        for (const tag of normalizedTags) {
          if (!skillTags.has(tag)) return false;
        }
      }

      return true;
    });

    const sorted = filtered.sort(
      makeSorter(query.sortBy ?? "downloads", query.sortOrder ?? "desc"),
    );
    const skills = sorted.slice(offset, offset + limit);

    return {
      skills,
      total: filtered.length,
      limit,
      offset,
    };
  }
}

export interface MarketplaceApiRequest {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
}

export interface MarketplaceApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface MarketplaceApiOptions {
  marketplace: SkillMarketplace;
  basePath?: string;
}

export function createMarketplaceApiHandler(
  options: MarketplaceApiOptions,
): (request: MarketplaceApiRequest) => Promise<MarketplaceApiResponse> {
  const basePath = options.basePath ?? "/api/marketplace";

  return async (request: MarketplaceApiRequest): Promise<MarketplaceApiResponse> => {
    if (request.method.toUpperCase() !== "GET") return json(405, { error: "method_not_allowed" });

    const path = stripQueryString(request.path);

    if (path === `${basePath}/skills`) {
      const query = parseQuery(request.query ?? {});
      const page = await options.marketplace.list(query);
      return json(200, page);
    }

    if (path.startsWith(`${basePath}/skills/`)) {
      const id = decodeURIComponent(path.slice(`${basePath}/skills/`.length));
      if (!id) return json(400, { error: "invalid_id" });

      const skill = await options.marketplace.get(id);
      if (!skill) return json(404, { error: "not_found" });
      return json(200, skill);
    }

    return json(404, { error: "not_found" });
  };
}

export function renderMarketplaceHtml(page: MarketplacePage, title = "Skill Marketplace"): string {
  const cards =
    page.skills.length === 0
      ? '<li class="empty">No skills found.</li>'
      : page.skills
          .map(
            (skill) => `<li class="card">
  <h2>${escapeHtml(skill.name)}</h2>
  <p class="meta"><code>${escapeHtml(skill.id)}</code> • v${escapeHtml(skill.latestVersion)} • by ${escapeHtml(skill.author)}</p>
  <p>${escapeHtml(skill.description)}</p>
  <p class="metrics">⭐ ${skill.rating.toFixed(1)} · ⬇ ${skill.downloads.toLocaleString()} · ${escapeHtml(skill.visibility)}</p>
  <p class="tags">${skill.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join(" ")}</p>
</li>`,
          )
          .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 900px; padding: 0 1rem; }
    ul { list-style: none; padding: 0; display: grid; gap: 1rem; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 1rem; }
    .meta, .metrics, .tags { color: #555; font-size: 0.95rem; }
    .empty { color: #666; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Showing ${page.skills.length} of ${page.total} skills.</p>
  <ul>${cards}</ul>
</body>
</html>`;
}

export interface MarketplaceWebOptions {
  marketplace: SkillMarketplace;
}

export async function renderMarketplacePage(
  options: MarketplaceWebOptions,
  query: MarketplaceQuery = {},
): Promise<string> {
  const page = await options.marketplace.list(query);
  return renderMarketplaceHtml(page);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function makeSorter(sortBy: MarketplaceSortBy, sortOrder: MarketplaceSortOrder) {
  const direction = sortOrder === "asc" ? 1 : -1;

  return (a: MarketplaceSkill, b: MarketplaceSkill): number => {
    const valueA = getSortValue(a, sortBy);
    const valueB = getSortValue(b, sortBy);

    if (valueA < valueB) return -1 * direction;
    if (valueA > valueB) return 1 * direction;

    return a.id.localeCompare(b.id);
  };
}

function getSortValue(skill: MarketplaceSkill, sortBy: MarketplaceSortBy): number | string {
  switch (sortBy) {
    case "name":
      return skill.name.toLowerCase();
    case "downloads":
      return skill.downloads;
    case "rating":
      return skill.rating;
    case "updatedAt":
      return new Date(skill.updatedAt).getTime();
  }
}

function parseQuery(query: Record<string, string | undefined>): MarketplaceQuery {
  const parsed: MarketplaceQuery = {};

  const search = query["search"]?.trim();
  if (search) parsed.search = search;

  const tags = query["tags"]
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags && tags.length > 0) parsed.tags = tags;

  const visibility = parseVisibility(query["visibility"]);
  if (visibility) parsed.visibility = visibility;

  const sortBy = parseSortBy(query["sortBy"]);
  if (sortBy) parsed.sortBy = sortBy;

  const sortOrder = parseSortOrder(query["sortOrder"]);
  if (sortOrder) parsed.sortOrder = sortOrder;

  const limit = parseNullableInt(query["limit"]);
  if (limit !== undefined) parsed.limit = limit;

  const offset = parseNullableInt(query["offset"]);
  if (offset !== undefined) parsed.offset = offset;

  return parsed;
}

function parseSortBy(value: string | undefined): MarketplaceSortBy | undefined {
  if (value === "name" || value === "downloads" || value === "rating" || value === "updatedAt") {
    return value;
  }
  return undefined;
}

function parseSortOrder(value: string | undefined): MarketplaceSortOrder | undefined {
  if (value === "asc" || value === "desc") return value;
  return undefined;
}

function parseVisibility(value: string | undefined): SkillVisibility | undefined {
  if (
    value === "public" ||
    value === "org-private" ||
    value === "team-private" ||
    value === "project-private"
  ) {
    return value;
  }
  return undefined;
}

function parseNullableInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stripQueryString(path: string): string {
  const q = path.indexOf("?");
  return q >= 0 ? path.slice(0, q) : path;
}

function json(status: number, payload: unknown): MarketplaceApiResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
