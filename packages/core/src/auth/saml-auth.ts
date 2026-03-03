import type { AuthContext, AuthResult } from "./auth-types.js";

export interface SamlAssertion {
  subject: string;
  email?: string;
  name?: string;
  orgId?: string;
  roles?: string[];
  attributes?: Record<string, unknown>;
  sessionIndex?: string;
  expiresAt?: string;
}

export interface SamlAuthOptions {
  verifySamlAssertion: (assertion: string) => Promise<SamlAssertion | null>;
}

const parseSaml = (headers: Record<string, string | undefined>): string | null =>
  headers["x-saml-assertion"] ?? null;

export const authenticateSaml = async (
  headers: Record<string, string | undefined>,
  options: SamlAuthOptions,
): Promise<AuthResult | null> => {
  const assertion = parseSaml(headers);
  if (!assertion) return null;

  const parsed = await options.verifySamlAssertion(assertion);
  if (!parsed) {
    return {
      ok: false,
      status: 401,
      error: "invalid_credentials",
      message: "Invalid SAML assertion",
    };
  }

  if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) {
    return { ok: false, status: 401, error: "expired", message: "SAML assertion expired" };
  }

  const context: AuthContext = {
    method: "saml2",
    identity: {
      id: parsed.subject,
      type: "user",
      roles: parsed.roles ?? [],
      scopes: [],
      ...(parsed.name ? { name: parsed.name } : {}),
      ...(parsed.email ? { email: parsed.email } : {}),
      ...(parsed.orgId ? { orgId: parsed.orgId } : {}),
      ...(parsed.attributes ? { claims: parsed.attributes } : {}),
    },
    ...(parsed.sessionIndex ? { sessionId: parsed.sessionIndex } : {}),
    ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
  };

  return { ok: true, status: 200, context };
};
