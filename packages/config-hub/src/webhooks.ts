export type WebhookEventType = "create" | "update" | "delete";

export interface WebhookRegistration {
  id: string;
  scope: "org" | "team" | "project";
  scopeId: string;
  endpoint: string;
  enabled: boolean;
}

export interface WebhookEvent {
  eventType: WebhookEventType;
  documentId: string;
  scope: "org" | "team" | "project";
  actor: string;
  timestamp: string;
}

export interface DeliveryResult {
  endpoint: string;
  attempts: number;
  success: boolean;
  error?: string;
}

export type WebhookSender = (endpoint: string, payload: WebhookEvent) => Promise<void>;

export class WebhookRegistry {
  private hooks = new Map<string, WebhookRegistration>();
  private nextId = 1;

  register(
    scope: WebhookRegistration["scope"],
    scopeId: string,
    endpoint: string,
  ): WebhookRegistration {
    const hook: WebhookRegistration = {
      id: `wh_${this.nextId++}`,
      scope,
      scopeId,
      endpoint,
      enabled: true,
    };
    this.hooks.set(hook.id, hook);
    return hook;
  }

  list(scope?: WebhookRegistration["scope"], scopeId?: string): WebhookRegistration[] {
    return [...this.hooks.values()].filter((h) => {
      if (scope && h.scope !== scope) return false;
      if (scopeId && h.scopeId !== scopeId) return false;
      return true;
    });
  }
}

export class WebhookDispatcher {
  constructor(
    private readonly registry: WebhookRegistry,
    private readonly sender: WebhookSender,
  ) {}

  async dispatch(
    event: Omit<WebhookEvent, "timestamp">,
    options: { maxRetries?: number; baseDelayMs?: number } = {},
  ): Promise<DeliveryResult[]> {
    const payload: WebhookEvent = { ...event, timestamp: new Date().toISOString() };
    const hooks = this.registry.list(event.scope).filter((h) => h.enabled);

    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 100;

    const results: DeliveryResult[] = [];

    for (const hook of hooks) {
      let attempts = 0;
      let success = false;
      let lastError = "";

      while (!success && attempts <= maxRetries) {
        attempts++;
        try {
          await this.sender(hook.endpoint, payload);
          success = true;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempts <= maxRetries) {
            const delay = baseDelayMs * 2 ** (attempts - 1);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }

      results.push({
        endpoint: hook.endpoint,
        attempts,
        success,
        ...(success ? {} : { error: lastError }),
      });
    }

    return results;
  }
}
