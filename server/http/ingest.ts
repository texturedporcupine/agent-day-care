import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bus } from "../bus.js";
import { agentEventPatchSchema } from "../../shared/schema.js";
import { checkIngestAuth } from "./auth.js";
import { MAX_BODY_BYTES, readJsonObjectBody, writeJsonError } from "./body.js";

/**
 * Canonical, authenticated ingest: POST /api/events with an AgentEventPatch JSON
 * body. This is the one endpoint every local agent (Sand, custom scripts, the
 * `npm run emit` helper, ...) can use without writing an adapter — the payload is
 * already the wire contract and is validated with zod at this boundary.
 *
 * Guarantees: POST only, `application/json` content type, object shape + zod
 * validation, a shared body-size cap, timing-safe token auth (INGEST_TOKEN), and
 * loopback-only access when no token is configured. Every failure is a small
 * JSON `{ error }` with the right status.
 */
export function createIngestHandler(bus: Bus) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST", "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "method not allowed; POST an AgentEventPatch" }));
      return;
    }

    const auth = checkIngestAuth(req);
    if (!auth.ok) {
      writeJsonError(res, auth.status, auth.error);
      return;
    }

    const contentType = String(req.headers["content-type"] ?? "");
    if (!contentType.toLowerCase().includes("application/json")) {
      writeJsonError(res, 415, "content-type must be application/json");
      return;
    }

    readJsonObjectBody(req, res, MAX_BODY_BYTES, (payload) => {
      const parsed = agentEventPatchSchema.safeParse(payload);
      if (!parsed.success) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "invalid AgentEventPatch", issues: parsed.error.issues }));
        return;
      }
      bus.publish(parsed.data);
      res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ accepted: true, agentId: parsed.data.agentId }));
    });
  };
}
