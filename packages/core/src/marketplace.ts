/**
 * Skill marketplace interface via API and web UI (SKILL-005).
 */

import type { SkillVisibility } from "./skill-schema.js";

export type MarketplaceSortBy = "name" | "downloads" | "rating" | "updatedAt";
export type MarketplaceSortOrder = "asc" | "desc";
export type SkillAnalyticsInterval = "daily" | "weekly" | "monthly";

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

export interface SkillInstallAnalyticsEvent {
  skillId: string;
  version: string;
  timestamp?: string;
}

export interface SkillInvocationAnalyticsEvent {
  skillId: string;
  version?: string;
  invocationCount?: number;
  parameters?: Record<string, unknown>;
  defaultParameters?: string[];
  timestamp?: string;
}

export interface SkillAnalyticsPoint {
  periodStart: string;
  count: number;
}

export interface SkillVersionInstallationCount {
  version: string;
  count: number;
}

export interface SkillParameterUsagePattern {
  parameter: string;
  usedCount: number;
  defaultUsedCount: number;
  overriddenCount: number;
}

export interface AuthorSkillAnalytics {
  author: string;
  interval: SkillAnalyticsInterval;
  generatedAt: string;
  installs: {
    byVersion: SkillVersionInstallationCount[];
    overTime: SkillAnalyticsPoint[];
  };
  invocations: {
    total: number;
    frequency: SkillAnalyticsPoint[];
  };
  parameterUsage: SkillParameterUsagePattern[];
}

export interface AuthorSkillAnalyticsQuery {
  interval?: SkillAnalyticsInterval;
  startTime?: Date;
  endTime?: Date;
}

export interface MarketplaceSkillAnalytics {
  recordInstall(event: SkillInstallAnalyticsEvent): Promise<void>;
  recordInvocation(event: SkillInvocationAnalyticsEvent): Promise<void>;
  getAuthorAnalytics(
    author: string,
    query?: AuthorSkillAnalyticsQuery,
  ): Promise<AuthorSkillAnalytics>;
}

interface StoredInstallAnalyticsEvent {
  skillId: string;
  version: string;
  timestamp: string;
}

interface StoredInvocationAnalyticsEvent {
  skillId: string;
  version: string | undefined;
  invocationCount: number;
  parameters: Record<string, unknown>;
  defaultParameters: Set<string>;
  timestamp: string;
}

export class InMemoryMarketplaceSkillAnalytics implements MarketplaceSkillAnalytics {
  private readonly installs: StoredInstallAnalyticsEvent[] = [];
  private readonly invocations: StoredInvocationAnalyticsEvent[] = [];

  constructor(
    private readonly marketplace: SkillMarketplace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordInstall(event: SkillInstallAnalyticsEvent): Promise<void> {
    this.installs.push({
      skillId: event.skillId,
      version: event.version,
      timestamp: event.timestamp ?? this.now().toISOString(),
    });
  }

  async recordInvocation(event: SkillInvocationAnalyticsEvent): Promise<void> {
    this.invocations.push({
      skillId: event.skillId,
      version: event.version,
      invocationCount: Math.max(0, Math.floor(event.invocationCount ?? 1)),
      parameters: event.parameters ?? {},
      defaultParameters: new Set(event.defaultParameters ?? []),
      timestamp: event.timestamp ?? this.now().toISOString(),
    });
  }

  async getAuthorAnalytics(
    author: string,
    query: AuthorSkillAnalyticsQuery = {},
  ): Promise<AuthorSkillAnalytics> {
    const page = await this.marketplace.list({ limit: 1000, offset: 0 });
    const authorSkillIds = new Set(
      page.skills.filter((skill) => skill.author === author).map((skill) => skill.id),
    );

    const startMs = query.startTime?.getTime();
    const endMs = query.endTime?.getTime();
    const interval = query.interval ?? "daily";

    const authorInstalls = this.installs.filter((event) => {
      if (!authorSkillIds.has(event.skillId)) return false;
      return withinRange(event.timestamp, startMs, endMs);
    });

    const authorInvocations = this.invocations.filter((event) => {
      if (!authorSkillIds.has(event.skillId)) return false;
      return withinRange(event.timestamp, startMs, endMs);
    });

    const installsByVersion = aggregateInstallationsByVersion(authorInstalls);
    const installsOverTime = aggregateOverTime(authorInstalls, interval, (_event) => 1);
    const invocationFrequency = aggregateOverTime(
      authorInvocations,
      interval,
      (event) => event.invocationCount,
    );

    const parameterUsage = aggregateParameterUsage(authorInvocations);

    return {
      author,
      interval,
      generatedAt: this.now().toISOString(),
      installs: {
        byVersion: installsByVersion,
        overTime: installsOverTime,
      },
      invocations: {
        total: authorInvocations.reduce((sum, event) => sum + event.invocationCount, 0),
        frequency: invocationFrequency,
      },
      parameterUsage,
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
  analytics?: MarketplaceSkillAnalytics;
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

    if (path === `${basePath}/skills/builder`) {
      return html(200, renderSkillBuilderHtml());
    }

    if (path.startsWith(`${basePath}/skills/`)) {
      const id = decodeURIComponent(path.slice(`${basePath}/skills/`.length));
      if (!id) return json(400, { error: "invalid_id" });

      const skill = await options.marketplace.get(id);
      if (!skill) return json(404, { error: "not_found" });
      return json(200, skill);
    }

    const authorAnalyticsPrefix = `${basePath}/authors/`;
    if (path.startsWith(authorAnalyticsPrefix) && path.endsWith("/analytics")) {
      if (!options.analytics) return json(501, { error: "analytics_not_configured" });

      const author = decodeURIComponent(
        path.slice(authorAnalyticsPrefix.length, -"/analytics".length),
      );
      if (!author) return json(400, { error: "invalid_author" });

      const analytics = await options.analytics.getAuthorAnalytics(
        author,
        parseAnalyticsQuery(request.query),
      );
      return json(200, analytics);
    }

    if (path.startsWith(authorAnalyticsPrefix) && path.endsWith("/analytics/dashboard")) {
      if (!options.analytics) {
        return json(501, { error: "analytics_not_configured" });
      }

      const author = decodeURIComponent(
        path.slice(authorAnalyticsPrefix.length, -"/analytics/dashboard".length),
      );
      if (!author) return json(400, { error: "invalid_author" });

      const analytics = await options.analytics.getAuthorAnalytics(
        author,
        parseAnalyticsQuery(request.query),
      );
      return html(200, renderMarketplaceAuthorAnalyticsHtml(analytics));
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

export function renderSkillBuilderHtml(title = "Visual Skill Builder"): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 960px; padding: 0 1rem; }
    .grid { display: grid; gap: 0.75rem; }
    .panel { border: 1px solid #ddd; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    label { display: grid; gap: 0.35rem; font-weight: 600; }
    input, textarea, select, button { font: inherit; }
    input, textarea, select { padding: 0.55rem; border-radius: 8px; border: 1px solid #ccc; }
    textarea { min-height: 7rem; }
    button { cursor: pointer; padding: 0.55rem 0.8rem; border-radius: 8px; border: 1px solid #888; background: #f7f7f7; }
    .row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.5rem; align-items: end; }
    pre { white-space: pre-wrap; background: #111; color: #f3f3f3; padding: 1rem; border-radius: 10px; overflow: auto; }
    .help { color: #555; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="help">Build a portable skill with a form (no YAML/JSON editing required), preview the generated schema, and test prompt rendering before publishing.</p>

  <section class="panel grid">
    <h2>Skill details</h2>
    <label>Skill name<input id="skillName" placeholder="acme/review" /></label>
    <label>Description<input id="skillDescription" placeholder="Reviews a pull request" /></label>
    <label>Version<input id="skillVersion" value="1.0.0" /></label>
    <label>Prompt body<textarea id="skillPrompt" placeholder="Review {{repo}} pull request #{{prNumber}}"></textarea></label>
  </section>

  <section class="panel grid">
    <h2>Parameters</h2>
    <div id="params" class="grid"></div>
    <button id="addParam" type="button">Add parameter</button>
  </section>

  <section class="panel grid">
    <h2>Preview & test</h2>
    <label>Test inputs (JSON object)<textarea id="testInput" placeholder='{"repo": "otterammo/laup", "prNumber": 38}'></textarea></label>
    <div>
      <button id="refresh" type="button">Generate preview</button>
    </div>
    <h3>Generated portable skill schema</h3>
    <pre id="schemaPreview"></pre>
    <h3>Rendered prompt preview</h3>
    <pre id="promptPreview"></pre>
  </section>

  <script>
    const paramsRoot = document.getElementById("params");
    const schemaPreview = document.getElementById("schemaPreview");
    const promptPreview = document.getElementById("promptPreview");

    function addParamRow(initial = { name: "", description: "", type: "string", required: true, default: "" }) {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = "<label>Name<input data-field="name" value="" + initial.name + "" /></label>"
        + "<label>Description<input data-field="description" value="" + initial.description + "" /></label>"
        + "<button type="button" data-remove="true">Remove</button>"
        + "<label>Type<select data-field="type">"
        + "<option value="string">string</option><option value="number">number</option>"
        + "<option value="boolean">boolean</option><option value="array">array</option>"
        + "<option value="object">object</option><option value="file">file</option>"
        + "<option value="selection">selection</option></select></label>"
        + "<label>Required<select data-field="required"><option value="true">true</option><option value="false">false</option></select></label>"
        + "<label>Default<input data-field="default" value="" + initial.default + "" /></label>";
      paramsRoot.appendChild(row);
      row.querySelector('[data-field="type"]').value = initial.type;
      row.querySelector('[data-field="required"]').value = String(initial.required);
      row.querySelector('[data-remove="true"]').addEventListener("click", () => {
        row.remove();
        refresh();
      });
      row.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", refresh));
    }

    function readSkillFromForm() {
      const parameters = Array.from(paramsRoot.children).map((row) => {
        const get = (field) => row.querySelector('[data-field="' + field + '"]').value.trim();
        const name = get("name");
        if (!name) return null;
        const param = {
          name,
          description: get("description") || undefined,
          type: get("type"),
          required: get("required") === "true",
        };
        const defaultValue = get("default");
        if (defaultValue) param.default = defaultValue;
        return param;
      }).filter(Boolean);

      return {
        schemaVersion: "1.0",
        name: document.getElementById("skillName").value.trim(),
        version: document.getElementById("skillVersion").value.trim() || "1.0.0",
        description: document.getElementById("skillDescription").value.trim(),
        parameters,
        prompt: document.getElementById("skillPrompt").value,
      };
    }

    function renderPrompt(skill, values) {
      let prompt = skill.prompt;
      for (const param of skill.parameters) {
        const resolved = values[param.name] ?? param.default;
        if (param.required && (resolved === undefined || resolved === null || resolved === "")) {
          throw new Error("Missing required parameter: " + param.name);
        }
        if (resolved !== undefined) {
          prompt = prompt.split("{{" + param.name + "}}").join(String(resolved));
        }
      }
      return prompt;
    }

    function refresh() {
      const skill = readSkillFromForm();
      schemaPreview.textContent = JSON.stringify(skill, null, 2);
      try {
        const values = JSON.parse(document.getElementById("testInput").value || "{}");
        promptPreview.textContent = renderPrompt(skill, values);
      } catch (error) {
        promptPreview.textContent = "Preview error: " + error.message;
      }
    }

    document.getElementById("addParam").addEventListener("click", () => { addParamRow(); refresh(); });
    document.getElementById("refresh").addEventListener("click", refresh);
    document.querySelectorAll("input,textarea").forEach((el) => el.addEventListener("input", refresh));

    addParamRow({ name: "repo", description: "Repository", type: "string", required: true, default: "" });
    addParamRow({ name: "prNumber", description: "Pull request number", type: "number", required: true, default: "" });
    refresh();
  </script>
</body>
</html>`;
}

export function renderMarketplaceAuthorAnalyticsHtml(
  analytics: AuthorSkillAnalytics,
  title = `Skill Analytics · ${analytics.author}`,
): string {
  const installsByVersion =
    analytics.installs.byVersion.length === 0
      ? '<li class="empty">No installs yet.</li>'
      : analytics.installs.byVersion
          .map((point) => `<li><code>${escapeHtml(point.version)}</code>: ${point.count}</li>`)
          .join("\n");

  const frequency =
    analytics.invocations.frequency.length === 0
      ? '<li class="empty">No invocations yet.</li>'
      : analytics.invocations.frequency
          .map((point) => `<li>${escapeHtml(point.periodStart)}: ${point.count}</li>`)
          .join("\n");

  const params =
    analytics.parameterUsage.length === 0
      ? '<li class="empty">No parameter usage yet.</li>'
      : analytics.parameterUsage
          .map(
            (entry) =>
              `<li><code>${escapeHtml(entry.parameter)}</code> used ${entry.usedCount}x · default ${entry.defaultUsedCount}x · overridden ${entry.overriddenCount}x</li>`,
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
    .section { border: 1px solid #ddd; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    ul { margin: 0.5rem 0 0; }
    .meta { color: #555; }
    .empty { color: #666; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Interval: ${escapeHtml(analytics.interval)} · Generated: ${escapeHtml(analytics.generatedAt)}</p>

  <section class="section">
    <h2>Installation counts</h2>
    <h3>Per version</h3>
    <ul>${installsByVersion}</ul>
    <h3>Over time</h3>
    <ul>${analytics.installs.overTime
      .map((point) => `<li>${escapeHtml(point.periodStart)}: ${point.count}</li>`)
      .join("\n")}</ul>
  </section>

  <section class="section">
    <h2>Invocation frequency</h2>
    <p>Total invocations: ${analytics.invocations.total}</p>
    <ul>${frequency}</ul>
  </section>

  <section class="section">
    <h2>Parameter usage patterns</h2>
    <ul>${params}</ul>
  </section>
</body>
</html>`;
}

export interface MarketplaceWebOptions {
  marketplace: SkillMarketplace;
  analytics?: MarketplaceSkillAnalytics;
}

export async function renderMarketplacePage(
  options: MarketplaceWebOptions,
  query: MarketplaceQuery = {},
): Promise<string> {
  const page = await options.marketplace.list(query);
  return renderMarketplaceHtml(page);
}

export async function renderMarketplaceAuthorAnalyticsPage(
  options: MarketplaceWebOptions,
  author: string,
  query: AuthorSkillAnalyticsQuery = {},
): Promise<string> {
  if (!options.analytics) throw new Error("Marketplace analytics not configured");
  const analytics = await options.analytics.getAuthorAnalytics(author, query);
  return renderMarketplaceAuthorAnalyticsHtml(analytics);
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

interface MarketplaceListQueryParams {
  search?: string;
  tags?: string;
  visibility?: string;
  sortBy?: string;
  sortOrder?: string;
  limit?: string;
  offset?: string;
}

function parseQuery(query: MarketplaceListQueryParams): MarketplaceQuery {
  const parsed: MarketplaceQuery = {};

  const search = query.search?.trim();
  if (search) parsed.search = search;

  const tags = query.tags
    ?.split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags && tags.length > 0) parsed.tags = tags;

  const visibility = parseVisibility(query.visibility);
  if (visibility) parsed.visibility = visibility;

  const sortBy = parseSortBy(query.sortBy);
  if (sortBy) parsed.sortBy = sortBy;

  const sortOrder = parseSortOrder(query.sortOrder);
  if (sortOrder) parsed.sortOrder = sortOrder;

  const limit = parseNullableInt(query.limit);
  if (limit !== undefined) parsed.limit = limit;

  const offset = parseNullableInt(query.offset);
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

interface MarketplaceAnalyticsQueryParams {
  interval?: string;
  startTime?: string;
  endTime?: string;
}

function parseAnalyticsQuery(
  query: MarketplaceAnalyticsQueryParams = {},
): AuthorSkillAnalyticsQuery {
  const parsed: AuthorSkillAnalyticsQuery = {};

  const interval = parseAnalyticsInterval(query.interval);
  if (interval) parsed.interval = interval;

  const startTime = parseDate(query.startTime);
  if (startTime) parsed.startTime = startTime;

  const endTime = parseDate(query.endTime);
  if (endTime) parsed.endTime = endTime;

  return parsed;
}

function parseAnalyticsInterval(value: string | undefined): SkillAnalyticsInterval | undefined {
  if (value === "daily" || value === "weekly" || value === "monthly") return value;
  return undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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

function html(status: number, payload: string): MarketplaceApiResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: payload,
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

function withinRange(timestamp: string, startMs?: number, endMs?: number): boolean {
  const time = new Date(timestamp).getTime();
  if (startMs !== undefined && time < startMs) return false;
  if (endMs !== undefined && time >= endMs) return false;
  return true;
}

function aggregateInstallationsByVersion(
  events: StoredInstallAnalyticsEvent[],
): SkillVersionInstallationCount[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.version, (counts.get(event.version) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version));
}

function aggregateOverTime<T extends { timestamp: string }>(
  events: T[],
  interval: SkillAnalyticsInterval,
  valueSelector: (event: T) => number,
): SkillAnalyticsPoint[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const key = periodStart(new Date(event.timestamp), interval);
    counts.set(key, (counts.get(key) ?? 0) + valueSelector(event));
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodStartValue, count]) => ({ periodStart: periodStartValue, count }));
}

function aggregateParameterUsage(
  events: StoredInvocationAnalyticsEvent[],
): SkillParameterUsagePattern[] {
  const usage = new Map<string, SkillParameterUsagePattern>();

  for (const event of events) {
    for (const parameter of Object.keys(event.parameters)) {
      const current = usage.get(parameter) ?? {
        parameter,
        usedCount: 0,
        defaultUsedCount: 0,
        overriddenCount: 0,
      };

      current.usedCount += event.invocationCount;
      if (event.defaultParameters.has(parameter)) {
        current.defaultUsedCount += event.invocationCount;
      } else {
        current.overriddenCount += event.invocationCount;
      }
      usage.set(parameter, current);
    }
  }

  return Array.from(usage.values()).sort(
    (a, b) => b.usedCount - a.usedCount || a.parameter.localeCompare(b.parameter),
  );
}

function periodStart(date: Date, interval: SkillAnalyticsInterval): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (interval === "daily") {
    return new Date(Date.UTC(year, month, day)).toISOString();
  }

  if (interval === "weekly") {
    const midnight = Date.UTC(year, month, day);
    const dayOfWeek = new Date(midnight).getUTCDay();
    const delta = (dayOfWeek + 6) % 7;
    return new Date(midnight - delta * 86_400_000).toISOString();
  }

  return new Date(Date.UTC(year, month, 1)).toISOString();
}
