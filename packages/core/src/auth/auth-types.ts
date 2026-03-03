import { z } from "zod";

export const AuthMethodSchema = z.enum(["api-key", "oauth2-oidc", "saml2"]);
export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const AuthIdentitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(["user", "service", "system", "agent"]),
  name: z.string().optional(),
  email: z.string().optional(),
  roles: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  orgId: z.string().optional(),
  claims: z.record(z.string(), z.unknown()).optional(),
});
export type AuthIdentity = z.infer<typeof AuthIdentitySchema>;

export interface AuthContext {
  method: AuthMethod;
  identity: AuthIdentity;
  sessionId?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export type AuthSuccess = {
  ok: true;
  status: 200;
  context: AuthContext;
};

export type AuthFailure = {
  ok: false;
  status: 401;
  error: "unauthenticated" | "invalid_credentials" | "expired";
  message: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

export interface RequestLike {
  path?: string;
  method?: string;
  headers: Record<string, string | undefined>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}
