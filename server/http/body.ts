import type { IncomingMessage, ServerResponse } from "node:http";

/** Shared cap for any JSON ingest endpoint (webhooks and /api/events). */
export const MAX_BODY_BYTES = 64 * 1024;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

/** Write a `{ error }` JSON body with the given status. Centralized so every
 * ingest path returns the same shape. */
export function writeJsonError(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify({ error }));
}

/**
 * Read a request body, enforce a byte cap, parse it as JSON, and require the
 * result to be a plain object. On success `onBody` is invoked with the parsed
 * object; on any failure the matching JSON error response is written here and
 * `onBody` is never called.
 *
 * The callback (rather than a Promise) is deliberate: error and success paths
 * fire synchronously inside the request's own "data"/"end" handlers, which keeps
 * the 413 rejection immediate (before the socket buffers more) and makes the
 * handlers trivial to drive from tests. This is the single body-parsing path
 * shared by the generic webhook collector and the canonical /api/events ingest,
 * so size limits, JSON errors, and object-shape checks never drift apart.
 */
export function readJsonObjectBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
  onBody: (value: Record<string, unknown>) => void,
): void {
  let body = "";
  let rejected = false;

  req.on("data", (chunk: Buffer) => {
    if (rejected) return;
    body += chunk.toString("utf8");
    if (body.length > maxBytes) {
      rejected = true;
      writeJsonError(res, 413, "payload too large");
      req.destroy();
    }
  });

  req.on("end", () => {
    if (rejected) return;
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      writeJsonError(res, 400, "invalid JSON");
      return;
    }
    // Adapters and the patch schema expect an object; a bare array/string/number
    // is malformed input, not a valid partial event.
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      writeJsonError(res, 400, "expected a JSON object");
      return;
    }
    onBody(payload as Record<string, unknown>);
  });

  req.on("error", () => {
    // Client aborted / socket error mid-body: nothing left to respond to.
  });
}
