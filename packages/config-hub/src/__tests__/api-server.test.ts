import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigApiServer, tokenAuthenticator } from "../api-server.js";
import { ScopeDocumentStore } from "../crud.js";

const DOC = `---
version: "1.0"
scope: project
---

# API
`;

describe("ConfigApiServer", () => {
  const roots: string[] = [];
  afterEach(() => {
    roots.forEach((r) => {
      rmSync(r, { recursive: true, force: true });
    });
  });

  async function setup() {
    const root = mkdtempSync(join(tmpdir(), "laup-api-"));
    roots.push(root);
    const store = new ScopeDocumentStore({
      projectPath: join(root, "laup.md"),
      orgPath: join(root, "org.md"),
      teamsDir: join(root, "teams"),
    });
    const server = new ConfigApiServer({ store, authenticate: tokenAuthenticator("token") });
    const port = await server.listen(0);
    return { server, base: `http://127.0.0.1:${port}/v1/configs` };
  }

  it("requires auth", async () => {
    const { server, base } = await setup();
    const res = await fetch(`${base}/project`);
    expect(res.status).toBe(401);
    await server.close();
  });

  it("supports CRUD", async () => {
    const { server, base } = await setup();
    const headers = { authorization: "Bearer token", "content-type": "application/json" };
    expect(
      (
        await fetch(`${base}/project`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: DOC }),
        })
      ).status,
    ).toBe(201);
    expect((await fetch(`${base}/project`, { headers })).status).toBe(200);
    expect(
      (
        await fetch(`${base}/project`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ content: DOC.replace("# API", "# Updated") }),
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${base}/project`, { method: "DELETE", headers })).status).toBe(200);
    await server.close();
  });

  it("returns structured validation errors", async () => {
    const { server, base } = await setup();
    const res = await fetch(`${base}/org`, {
      method: "POST",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ content: "---\n:bad\n---\n" }),
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    await server.close();
  });
});
