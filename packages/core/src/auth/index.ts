export type { ApiKeyAuthOptions } from "./api-key-auth.js";
export { authenticateApiKey } from "./api-key-auth.js";
export type { AuthMiddlewareOptions } from "./auth-middleware.js";
export { authenticateRequest } from "./auth-middleware.js";
export type {
  AuthContext,
  AuthFailure,
  AuthIdentity,
  AuthMethod,
  AuthResult,
  AuthSuccess,
  RequestLike,
} from "./auth-types.js";
export { AuthIdentitySchema, AuthMethodSchema } from "./auth-types.js";
export type { OauthAuthOptions, OidcClaims } from "./oauth-auth.js";
export { authenticateOauth } from "./oauth-auth.js";
export type { SamlAssertion, SamlAuthOptions } from "./saml-auth.js";
export { authenticateSaml } from "./saml-auth.js";
