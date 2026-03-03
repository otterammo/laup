import type { AuditStorage } from "../audit-storage.js";
import { type ApiKeyAuthOptions, authenticateApiKey } from "./api-key-auth.js";
import type { AuthResult, RequestLike } from "./auth-types.js";
import { authenticateOauth, type OauthAuthOptions } from "./oauth-auth.js";
import { authenticateSaml, type SamlAuthOptions } from "./saml-auth.js";

export interface AuthMiddlewareOptions {
  apiKey?: ApiKeyAuthOptions;
  oauth?: OauthAuthOptions;
  saml?: SamlAuthOptions;
  auditStorage?: AuditStorage;
}

const normalizeHeaders = (
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
};

const auditAuth = async (
  request: RequestLike,
  result: AuthResult,
  auditStorage?: AuditStorage,
): Promise<void> => {
  if (!auditStorage) return;

  await auditStorage.append({
    category: "auth",
    action: result.ok ? "authenticate.success" : "authenticate.failure",
    actor: result.ok ? result.context.identity.id : "anonymous",
    targetType: "api-request",
    targetId: request.path,
    severity: result.ok ? "info" : "warning",
    correlationId: request.requestId,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    metadata: {
      method: result.ok ? result.context.method : "none",
      httpMethod: request.method,
      path: request.path,
      authError: result.ok ? undefined : result.error,
    },
  });
};

export const authenticateRequest = async (
  request: RequestLike,
  options: AuthMiddlewareOptions,
): Promise<AuthResult> => {
  const headers = normalizeHeaders(request.headers);

  const attempts: Array<Promise<AuthResult | null>> = [];
  if (options.apiKey) attempts.push(authenticateApiKey(headers, options.apiKey));
  if (options.oauth) attempts.push(authenticateOauth(headers, options.oauth));
  if (options.saml) attempts.push(authenticateSaml(headers, options.saml));

  for (const attempt of attempts) {
    const result = await attempt;
    if (!result) continue;
    await auditAuth(request, result, options.auditStorage);
    return result;
  }

  const unauthenticated: AuthResult = {
    ok: false,
    status: 401,
    error: "unauthenticated",
    message: "Authentication required",
  };
  await auditAuth(request, unauthenticated, options.auditStorage);
  return unauthenticated;
};
