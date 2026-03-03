import { describe, expect, it } from "vitest";
import { InMemoryAuditStorage } from "../../audit-storage.js";
import { authenticateRequest } from "../../auth/auth-middleware.js";
import { InMemoryCredentialStore, TestEncryptionProvider } from "../../credential-store.js";

describe("auth middleware (PERM-001)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const result = await authenticateRequest(
      { headers: {}, path: "/v1/config", method: "GET" },
      {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("unauthenticated");
    }
  });

  it("authenticates API key requests", async () => {
    const store = new InMemoryCredentialStore(new TestEncryptionProvider());
    await store.init();

    const keyId = await store.store(
      {
        name: "svc-key",
        type: "api-key",
        ownerId: "svc-1",
        ownerType: "team",
      },
      "secret-123",
    );

    const result = await authenticateRequest(
      {
        headers: {
          "x-api-key-id": keyId,
          "x-api-key": "secret-123",
        },
        method: "POST",
        path: "/v1/run",
      },
      {
        apiKey: {
          credentialStore: store,
          accessor: "test",
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.method).toBe("api-key");
      expect(result.context.identity.id).toBe("svc-1");
    }
  });

  it("authenticates OAuth/OIDC bearer requests", async () => {
    const result = await authenticateRequest(
      {
        headers: { authorization: "Bearer good-token" },
        method: "GET",
        path: "/v1/me",
      },
      {
        oauth: {
          verifyBearerToken: async (token) =>
            token === "good-token"
              ? { sub: "user-1", email: "u@example.com", scope: "read write" }
              : null,
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.method).toBe("oauth2-oidc");
      expect(result.context.identity.id).toBe("user-1");
    }
  });

  it("authenticates SAML requests", async () => {
    const result = await authenticateRequest(
      {
        headers: { "x-saml-assertion": "signed-assertion" },
        method: "GET",
        path: "/v1/sso/callback",
      },
      {
        saml: {
          verifySamlAssertion: async (assertion) =>
            assertion === "signed-assertion"
              ? { subject: "user-2", email: "user2@example.com", orgId: "org-1" }
              : null,
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.method).toBe("saml2");
      expect(result.context.identity.id).toBe("user-2");
    }
  });

  it("records auth method in audit log entries", async () => {
    const store = new InMemoryCredentialStore(new TestEncryptionProvider());
    await store.init();
    const keyId = await store.store(
      { name: "svc-key", type: "api-key", ownerId: "svc-1", ownerType: "team" },
      "secret-123",
    );

    const audit = new InMemoryAuditStorage();
    await audit.init();

    await authenticateRequest(
      {
        headers: { "x-api-key-id": keyId, "x-api-key": "secret-123" },
        method: "POST",
        path: "/v1/run",
      },
      {
        apiKey: { credentialStore: store, accessor: "test" },
        auditStorage: audit,
      },
    );

    const page = await audit.query({ category: "auth" });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries[0]?.metadata?.["method"]).toBe("api-key");
  });
});
