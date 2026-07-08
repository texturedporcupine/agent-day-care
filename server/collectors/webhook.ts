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
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_BYTES) {
        rejected = true;
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "payload too large" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        const payload = JSON.parse(body) as unknown;
        // Adapters expect an object; a bare array/string/number is malformed.
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
          throw new Error("expected a JSON object");
        }
        const patch = adapterFor(sourceId)(payload as Record<string, unknown>);
        if (patch) bus.publish(patch);
        res.writeHead(patch ? 202 : 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ accepted: Boolean(patch) }));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
    });
    req.on("error", () => {
      // Client aborted / socket error mid-body: nothing left to respond to.
    });
  };
}
