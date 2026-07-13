import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type AuthResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Constant-time string comparison. Both inputs are hashed to a fixed-length
 * digest first so the comparison never leaks the secret's length (timingSafeEqual
 * itself throws on differing lengths) while staying timing-safe.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** True for requests arriving over the loopback interface (127.0.0.0/8 or ::1). */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress;
  if (!addr) return false;
  return (
    addr === "::1" ||
    addr === "::ffff:127.0.0.1" ||
    addr.startsWith("127.") ||
    addr.startsWith("::ffff:127.")
  );
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

/**
 * Authorize an ingest request against INGEST_TOKEN.
 *
 * - When INGEST_TOKEN is set, a matching `Authorization: Bearer <token>` header
 *   is required (timing-safe); anything else is 401.
 * - When it is NOT set, only loopback requests are accepted so the unauthenticated
 *   endpoint can never be reached from another host; non-loopback callers get 401
 *   telling them to configure a token. main.ts additionally warns loudly at boot.
 */
export function checkIngestAuth(req: IncomingMessage, token = process.env.INGEST_TOKEN): AuthResult {
  if (token) {
    const provided = bearerToken(req);
    if (provided && timingSafeEqualStr(provided, token)) return { ok: true };
    return { ok: false, status: 401, error: "invalid or missing ingest token" };
  }
  if (isLoopbackRequest(req)) return { ok: true };
  return {
    ok: false,
    status: 401,
    error: "ingest token required for non-loopback requests; set INGEST_TOKEN",
  };
}
