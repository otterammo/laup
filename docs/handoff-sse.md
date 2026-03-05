# Real-time handoff streaming (HAND-012)

LAUP core exposes a Server-Sent Events (SSE) helper for streaming async handoff packets to
receiving agents with low-latency push delivery.

Implementation source: `packages/core/src/handoff-sse.ts`

## What it provides

- **SSE framing helpers** (`serializeSseEvent`, `serializeSseComment`)
- **SSE session builder** (`createHandoffSseSession`) tied to `HandoffQueue`
- **Operational defaults**:
  - heartbeat: `15s`
  - replay backlog on connect: `50` queued packets
  - response headers for proxy-safe SSE delivery

## Event model

Session emits these event types:

- `ready` — sent immediately after connect with metadata (`receivingTool`, `connectedAt`)
- `handoff` — sent for replayed queued packets and new live packets
- `error` — emitted if heartbeat write fails

A periodic heartbeat comment is also emitted:

```text
: keepalive 2026-03-05T11:00:00.000Z
```

## Example (Node HTTP)

```ts
import { createHandoffQueue, createHandoffSseSession } from "@laup/core";

const queue = createHandoffQueue();

async function handleHandoffSse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = createHandoffSseSession(queue, {
    receivingTool: "claude-code",
    heartbeatMs: 15_000,
    replayLimit: 50,
    retryMs: 2_000,
  });

  for (const [name, value] of Object.entries(session.headers)) {
    res.setHeader(name, value);
  }
  res.flushHeaders?.();

  const stop = await session.start(async (chunk) => {
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => {
        res.once("drain", resolve);
      });
    }
  });

  req.on("close", () => {
    stop();
    res.end();
  });
}
```

## Notes

- Backlog replay uses `handoffQueue.poll`, which marks replayed packets as `delivered`.
- `replayLimit` must be a positive integer.
- `heartbeatMs` must be `> 0`.
