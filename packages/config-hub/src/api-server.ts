import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { type ConfigScope, ScopeCrudError, type ScopeDocumentStore } from "./crud.js";

export interface AuthIdentity {
  id: string;
}
export type RequestAuthenticator = (req: IncomingMessage) => AuthIdentity | null;
export interface ConfigApiServerOptions {
  store: ScopeDocumentStore;
  authenticate: RequestAuthenticator;
}

export class ConfigApiServer {
  private readonly server: Server;
  constructor(private readonly options: ConfigApiServerOptions) {
    this.server = createServer((req, res) => void this.handle(req, res));
  }
  listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (!address || typeof address === "string")
          return reject(new Error("Failed to bind API server"));
        resolve(address.port);
      });
    });
  }
  close(): Promise<void> {
    return new Promise((resolve, reject) => this.server.close((e) => (e ? reject(e) : resolve())));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.options.authenticate(req))
      return this.respond(res, 401, {
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    const route = this.parseRoute(req.url ?? "/");
    if (!route)
      return this.respond(res, 404, { error: { code: "NOT_FOUND", message: "Route not found" } });
    try {
      if (req.method === "GET") return this.respond(res, 200, this.options.store.read(route));
      if (req.method === "DELETE") return this.respond(res, 200, this.options.store.delete(route));
      if (req.method === "POST" || req.method === "PUT") {
        const body = (await this.readJson(req)) as { content?: unknown };
        if (typeof body.content !== "string")
          throw new ScopeCrudError(
            "INVALID_REQUEST",
            "Request body must include string field: content",
            400,
          );
        const result =
          req.method === "POST"
            ? this.options.store.create(route, body.content)
            : this.options.store.update(route, body.content);
        return this.respond(res, req.method === "POST" ? 201 : 200, result);
      }
      return this.respond(res, 405, {
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      });
    } catch (error) {
      if (error instanceof ScopeCrudError)
        return this.respond(res, error.status, {
          error: { code: error.code, message: error.message, details: error.details ?? null },
        });
      if (error instanceof SyntaxError)
        return this.respond(res, 400, { error: { code: "INVALID_JSON", message: error.message } });
      // Log unexpected errors on the server, but do not expose details to the client.
      console.error("Unhandled error in ConfigApiServer.handle:", error);
      return this.respond(res, 500, {
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
    }
  }

  private parseRoute(url: string): { scope: ConfigScope; scopeId?: string } | null {
    const parts = new URL(url, "http://localhost").pathname.split("/").filter(Boolean);
    if (parts[0] !== "v1" || parts[1] !== "configs") return null;
    const scope = parts[2] as ConfigScope | undefined;
    if (scope !== "org" && scope !== "team" && scope !== "project") return null;
    return { scope, ...(parts[3] ? { scopeId: parts[3] } : {}) };
  }

  private async readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  }

  private respond(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }
}

export function tokenAuthenticator(expectedToken: string): RequestAuthenticator {
  return (req) => {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const [scheme, token] = auth.split(" ");
    return scheme === "Bearer" && token === expectedToken ? { id: "api-token" } : null;
  };
}
