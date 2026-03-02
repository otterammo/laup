import { describe, expect, it, vi } from "vitest";
import { WebhookDispatcher, WebhookRegistry } from "../webhooks.js";

describe("WebhookRegistry", () => {
  it("registers endpoints per scope", () => {
    const r = new WebhookRegistry();
    const hook = r.register("project", "p1", "https://example.com/hook");

    expect(hook.id).toBe("wh_1");
    expect(r.list("project", "p1")).toHaveLength(1);
  });
});

describe("WebhookDispatcher", () => {
  it("dispatches create/update/delete payload shape", async () => {
    const registry = new WebhookRegistry();
    registry.register("project", "p1", "https://example.com/hook");

    const sender = vi.fn(async () => {});
    const dispatcher = new WebhookDispatcher(registry, sender);

    await dispatcher.dispatch({
      eventType: "create",
      documentId: "doc-1",
      scope: "project",
      actor: "alice",
    });

    expect(sender).toHaveBeenCalledTimes(1);
    const [, payload] = sender.mock.calls[0] ?? [];
    expect(payload.eventType).toBe("create");
    expect(payload.documentId).toBe("doc-1");
    expect(payload.actor).toBe("alice");
    expect(payload.timestamp).toBeDefined();
  });

  it("retries failed deliveries with exponential backoff", async () => {
    const registry = new WebhookRegistry();
    registry.register("project", "p1", "https://example.com/hook");

    let attempts = 0;
    const sender = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error("temporary fail");
    });

    const dispatcher = new WebhookDispatcher(registry, sender);
    const results = await dispatcher.dispatch(
      {
        eventType: "update",
        documentId: "doc-1",
        scope: "project",
        actor: "alice",
      },
      { maxRetries: 3, baseDelayMs: 1 },
    );

    expect(attempts).toBe(3);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.attempts).toBe(3);
  });
});
