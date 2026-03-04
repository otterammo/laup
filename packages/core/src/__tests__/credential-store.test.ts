import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditStorage } from "../audit-storage.js";
import {
  type CredentialMetadata,
  type CredentialStore,
  type EncryptionProvider,
  InMemoryCredentialStore,
  TestEncryptionProvider,
} from "../credential-store.js";

describe("credential-store", () => {
  let store: CredentialStore;

  const makeMetadata = (
    overrides: Partial<Omit<CredentialMetadata, "createdAt">> = {},
  ): Omit<CredentialMetadata, "createdAt"> => ({
    name: "Test Credential",
    type: "api-key",
    ownerId: "user-1",
    ownerType: "user",
    ...overrides,
  });

  beforeEach(async () => {
    store = new InMemoryCredentialStore();
    await store.init();
  });

  describe("store", () => {
    it("stores a credential and returns an id", async () => {
      const id = await store.store(makeMetadata(), "secret-value");
      expect(id).toMatch(/^cred_/);
    });

    it("sets createdAt automatically", async () => {
      const id = await store.store(makeMetadata(), "secret");
      const meta = await store.getMetadata(id);
      expect(meta?.createdAt).toBeDefined();
    });
  });

  describe("get", () => {
    it("retrieves the decrypted credential value", async () => {
      const id = await store.store(makeMetadata(), "my-api-key");
      const value = await store.get(id, "test-user");
      expect(value).toBe("my-api-key");
    });

    it("returns null for unknown id", async () => {
      const value = await store.get("unknown", "test-user");
      expect(value).toBeNull();
    });

    it("updates lastAccessedAt on read", async () => {
      const id = await store.store(makeMetadata(), "secret");

      const before = await store.getMetadata(id);
      expect(before?.lastAccessedAt).toBeUndefined();

      await store.get(id, "test-user");

      const after = await store.getMetadata(id);
      expect(after?.lastAccessedAt).toBeDefined();
    });

    it("logs access", async () => {
      const id = await store.store(makeMetadata(), "secret");
      await store.get(id, "accessor-1");

      const history = await store.getAccessHistory(id);
      expect(history).toHaveLength(1);
      expect(history[0]?.accessor).toBe("accessor-1");
      expect(history[0]?.action).toBe("read");
      expect(history[0]?.success).toBe(true);
    });
  });

  describe("getMetadata", () => {
    it("returns metadata without the value", async () => {
      const id = await store.store(makeMetadata({ name: "My Key", service: "github" }), "secret");

      const meta = await store.getMetadata(id);
      expect(meta?.name).toBe("My Key");
      expect(meta?.service).toBe("github");
    });

    it("returns null for unknown id", async () => {
      const meta = await store.getMetadata("unknown");
      expect(meta).toBeNull();
    });
  });

  describe("list", () => {
    it("lists all credentials", async () => {
      await store.store(makeMetadata({ name: "Key 1" }), "s1");
      await store.store(makeMetadata({ name: "Key 2" }), "s2");

      const list = await store.list({});
      expect(list).toHaveLength(2);
    });

    it("filters by owner", async () => {
      await store.store(makeMetadata({ ownerId: "user-1" }), "s1");
      await store.store(makeMetadata({ ownerId: "user-2" }), "s2");

      const list = await store.list({ ownerId: "user-1" });
      expect(list).toHaveLength(1);
    });

    it("filters by type", async () => {
      await store.store(makeMetadata({ type: "api-key" }), "s1");
      await store.store(makeMetadata({ type: "password" }), "s2");

      const list = await store.list({ type: "api-key" });
      expect(list).toHaveLength(1);
    });

    it("filters by service", async () => {
      await store.store(makeMetadata({ service: "github" }), "s1");
      await store.store(makeMetadata({ service: "aws" }), "s2");

      const list = await store.list({ service: "github" });
      expect(list).toHaveLength(1);
    });

    it("filters by tag", async () => {
      await store.store(makeMetadata({ tags: ["prod", "critical"] }), "s1");
      await store.store(makeMetadata({ tags: ["dev"] }), "s2");

      const list = await store.list({ tag: "prod" });
      expect(list).toHaveLength(1);
    });

    it("excludes expired by default", async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const future = new Date(Date.now() + 100000).toISOString();

      await store.store(makeMetadata({ expiresAt: past }), "s1");
      await store.store(makeMetadata({ expiresAt: future }), "s2");

      const list = await store.list({});
      expect(list).toHaveLength(1);
    });

    it("includes expired when requested", async () => {
      const past = new Date(Date.now() - 1000).toISOString();

      await store.store(makeMetadata({ expiresAt: past }), "s1");

      const list = await store.list({ includeExpired: true });
      expect(list).toHaveLength(1);
    });
  });

  describe("update", () => {
    it("updates the credential value", async () => {
      const id = await store.store(makeMetadata(), "old-value");

      await store.update(id, "new-value", "admin");

      const value = await store.get(id, "test");
      expect(value).toBe("new-value");
    });

    it("throws for unknown id", async () => {
      await expect(store.update("unknown", "value", "admin")).rejects.toThrow("not found");
    });

    it("logs access", async () => {
      const id = await store.store(makeMetadata(), "old");
      await store.update(id, "new", "admin");

      const history = await store.getAccessHistory(id);
      const writeLog = history.find((h) => h.action === "write");
      expect(writeLog).toBeDefined();
    });
  });

  describe("rotate", () => {
    it("updates the value and sets rotatedAt", async () => {
      const id = await store.store(makeMetadata(), "old");

      const before = await store.getMetadata(id);
      expect(before?.rotatedAt).toBeUndefined();

      await store.rotate(id, "new", "admin");

      const after = await store.getMetadata(id);
      expect(after?.rotatedAt).toBeDefined();

      const value = await store.get(id, "test");
      expect(value).toBe("new");
    });

    it("logs rotation access", async () => {
      const id = await store.store(makeMetadata(), "old");
      await store.rotate(id, "new", "admin");

      const history = await store.getAccessHistory(id);
      const rotateLog = history.find((h) => h.action === "rotate");
      expect(rotateLog).toBeDefined();
    });
  });

  describe("revoke", () => {
    it("revokes credential and blocks reads", async () => {
      const id = await store.store(makeMetadata(), "secret");

      await store.revoke(id, "user-1", "compromised");

      const meta = await store.getMetadata(id);
      expect(meta?.status).toBe("revoked");
      expect(meta?.revokedBy).toBe("user-1");

      const value = await store.get(id, "user-1");
      expect(value).toBeNull();
    });
  });

  describe("access policy", () => {
    it("allows owner to configure read ACL and enforces it", async () => {
      const id = await store.store(makeMetadata(), "secret");

      await store.setAccessPolicy(
        id,
        { readers: ["svc-reader"], allowOwnerAccess: false },
        "user-1",
      );

      const denied = await store.get(id, "user-1");
      expect(denied).toBeNull();

      const allowed = await store.get(id, { accessorId: "svc-reader", accessorType: "service" });
      expect(allowed).toBe("secret");
    });

    it("prevents non-owner policy updates", async () => {
      const id = await store.store(makeMetadata(), "secret");
      await expect(store.setAccessPolicy(id, { readers: ["x"] }, "user-2")).rejects.toThrow(
        "Only owner",
      );
    });
  });

  describe("delete", () => {
    it("removes the credential", async () => {
      const id = await store.store(makeMetadata(), "secret");

      await store.delete(id, "admin");

      const meta = await store.getMetadata(id);
      expect(meta).toBeNull();
    });

    it("logs deletion", async () => {
      const id = await store.store(makeMetadata(), "secret");
      await store.delete(id, "admin");

      // Access log still exists even after deletion
      const history = await store.getAccessHistory(id);
      const deleteLog = history.find((h) => h.action === "delete");
      expect(deleteLog?.success).toBe(true);
    });
  });

  describe("isExpired", () => {
    it("returns false for non-expiring credentials", async () => {
      const id = await store.store(makeMetadata(), "secret");
      expect(await store.isExpired(id)).toBe(false);
    });

    it("returns false for future expiration", async () => {
      const future = new Date(Date.now() + 100000).toISOString();
      const id = await store.store(makeMetadata({ expiresAt: future }), "secret");
      expect(await store.isExpired(id)).toBe(false);
    });

    it("returns true for past expiration", async () => {
      const past = new Date(Date.now() - 1000).toISOString();
      const id = await store.store(makeMetadata({ expiresAt: past }), "secret");
      expect(await store.isExpired(id)).toBe(true);
    });
  });

  describe("getStaleCredentials", () => {
    it("returns credentials not rotated in max age days", async () => {
      await store.store(makeMetadata({ name: "Fresh" }), "s1");
      const stale = await store.getStaleCredentials(90);
      expect(stale).toHaveLength(0);
    });

    it("supports explicit rotation periods", async () => {
      const id = await store.store(makeMetadata({ rotationPeriodDays: -1 }), "s1");
      const stale = await store.getStaleCredentials(999);
      expect(stale.some((c) => c.name === "Test Credential")).toBe(true);

      await store.rotate(id, "new", "user-1");
      const staleAfterRotate = await store.getStaleCredentials(999);
      expect(staleAfterRotate.some((c) => c.name === "Test Credential")).toBe(true);
    });
  });

  describe("audit integration", () => {
    it("writes security audit events for secret lifecycle", async () => {
      const audit = new InMemoryAuditStorage();
      await audit.init();
      const auditableStore = new InMemoryCredentialStore(new TestEncryptionProvider(), audit);
      await auditableStore.init();

      const id = await auditableStore.store(makeMetadata(), "secret");
      await auditableStore.get(id, "user-1");
      await auditableStore.rotate(id, "secret2", "user-1");
      await auditableStore.revoke(id, "user-1");

      const page = await audit.query({ category: "security" });
      const actions = page.entries.map((e) => e.action);
      expect(actions).toContain("credential.create");
      expect(actions).toContain("credential.read");
      expect(actions).toContain("credential.rotate");
      expect(actions).toContain("credential.revoke");
    });
  });

  describe("TestEncryptionProvider", () => {
    let encryption: EncryptionProvider;

    beforeEach(() => {
      encryption = new TestEncryptionProvider();
    });

    it("encrypts and decrypts correctly", async () => {
      const original = "secret-data";
      const encrypted = await encryption.encrypt(original);
      const decrypted = await encryption.decrypt(encrypted);

      expect(encrypted).not.toBe(original);
      expect(decrypted).toBe(original);
    });

    it("uses base64 encoding", async () => {
      const encrypted = await encryption.encrypt("test");
      expect(encrypted).toBe(Buffer.from("test").toString("base64"));
    });

    it("has version 1", () => {
      expect(encryption.version).toBe(1);
    });

    it("never needs re-encryption", () => {
      expect(encryption.needsReencryption(1)).toBe(false);
      expect(encryption.needsReencryption(0)).toBe(false);
    });
  });

  describe("reencryptAll", () => {
    it("returns 0 when no re-encryption needed", async () => {
      await store.store(makeMetadata(), "secret");
      const count = await store.reencryptAll("admin");
      expect(count).toBe(0);
    });
  });
});
