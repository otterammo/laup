import type { CredentialStore } from "../credential-store.js";
import type { AuthResult } from "./auth-types.js";

const parseApiKey = (
  headers: Record<string, string | undefined>,
): { keyId: string; key: string } | null => {
  const keyId = headers["x-api-key-id"];
  const key = headers["x-api-key"];
  if (keyId && key) return { keyId, key };

  const auth = headers["authorization"];
  if (!auth) return null;
  const [scheme, value] = auth.split(" ");
  if (scheme?.toLowerCase() !== "apikey" || !value) return null;

  const [parsedId, parsedKey] = value.split(":");
  if (!parsedId || !parsedKey) return null;
  return { keyId: parsedId, key: parsedKey };
};

export interface ApiKeyAuthOptions {
  credentialStore: CredentialStore;
  accessor: string;
}

export const authenticateApiKey = async (
  headers: Record<string, string | undefined>,
  options: ApiKeyAuthOptions,
): Promise<AuthResult | null> => {
  const parsed = parseApiKey(headers);
  if (!parsed) return null;

  const metadata = await options.credentialStore.getMetadata(parsed.keyId);
  if (!metadata || metadata.type !== "api-key") {
    return {
      ok: false,
      status: 401,
      error: "invalid_credentials",
      message: "Invalid API key",
    };
  }

  const value = await options.credentialStore.get(parsed.keyId, options.accessor);
  if (value !== parsed.key) {
    return {
      ok: false,
      status: 401,
      error: "invalid_credentials",
      message: "Invalid API key",
    };
  }

  return {
    ok: true,
    status: 200,
    context: {
      method: "api-key",
      identity: {
        id: metadata.ownerId,
        type: "service",
        name: metadata.service ?? metadata.name,
        roles: [],
        scopes: metadata.allowedScopes ?? [],
        claims: { credentialId: parsed.keyId },
      },
    },
  };
};
