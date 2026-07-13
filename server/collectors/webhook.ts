import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bus } from "../bus.js";
import { adapterFor } from "../adapters/index.js";
import { MAX_BODY_BYTES, readJsonObjectBody, writeJsonError } from "../http/body.js";

/**
 * Generic webhook collector: POST /hooks/:sourceId with a JSON body.
 * The sourceId picks an adapter (claude, chatgtm, ...); unknown ids fall back
 * to the passthrough adapter which accepts AgentEventPatch-shaped payloads.
 * Optional shared secret via the X-Daycare-Secret header (WEBHOOK_SECRET).
 *
 * Body reading, the size cap, and JSON/object-shape validation are shared with
 * the canonical /api/events ingest via server/http/body.ts.
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

    readJsonObjectBody(req, res, MAX_BODY_BYTES, (payload) => {
      try {
        const patch = adapterFor(sourceId)(payload);
        if (patch) bus.publish(patch);
        res.writeHead(patch ? 202 : 200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: Boolean(patch) }));
      } catch {
        // A defensive adapter shouldn't throw, but never let one crash the bus.
        writeJsonError(res, 400, "could not process payload");
      }
    });
  };
}
