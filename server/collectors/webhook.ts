import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bus } from "../bus.js";
import { adapterFor } from "../adapters/index.js";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Generic webhook collector: POST /hooks/:sourceId with a JSON body.
 * The sourceId picks an adapter (claude, chatgtm, ...); unknown ids fall back
 * to the passthrough adapter which accepts AgentEventPatch-shaped payloads.
 * Optional shared secret via the X-Daycare-Secret header (WEBHOOK_SECRET).
 */
export function createWebhookHandler(bus: Bus) {
  const secret = process.env.WEBHOOK_SECRET;

  return (req: IncomingMessage, res: ServerResponse): void => {
    const sourceId = req.url?.match(/^\/hooks\/([\w-]+)$/)?.[1];
    if (!sourceId || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    if (secret && req.headers["x-daycare-secret"] !== secret) {
      res.writeHead(401).end();
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        const patch = adapterFor(sourceId)(payload);
        if (patch) bus.publish(patch);
        res.writeHead(patch ? 202 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: Boolean(patch) }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
    });
  };
}
