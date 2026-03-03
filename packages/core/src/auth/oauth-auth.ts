import type { AuthContext, AuthResult } from "./auth-types.js";

export interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  org_id?: string;
  scope?: string;
  exp?: number;
  [key: string]: unknown;
}

export interface OauthAuthOptions {
  verifyBearerToken: (token: string) => Promise<OidcClaims | null>;
}

const parseBearer = (headers: Record<string, string | undefined>): string | null => {
  const auth = headers["authorization"];
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
};

export const authenticateOauth = async (
  headers: Record<string, string | undefined>,
  options: OauthAuthOptions,
): Promise<AuthResult | null> => {
  const token = parseBearer(headers);
  if (!token) return null;

  const claims = await options.verifyBearerToken(token);
  if (!claims) {
    return {
      ok: false,
      status: 401,
      error: "invalid_credentials",
      message: "Invalid OAuth/OIDC token",
    };
  }

  if (claims.exp && claims.exp * 1000 < Date.now()) {
    return { ok: false, status: 401, error: "expired", message: "OAuth/OIDC token expired" };
  }

  const context: AuthContext = {
    method: "oauth2-oidc",
    identity: {
      id: claims.sub,
      type: "user",
      roles: [],
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
      claims,
      ...(claims.name ? { name: claims.name } : {}),
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.org_id ? { orgId: claims.org_id } : {}),
    },
    ...(claims.exp ? { expiresAt: new Date(claims.exp * 1000).toISOString() } : {}),
  };

  return { ok: true, status: 200, context };
};
