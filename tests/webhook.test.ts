import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Bus } from "../server/bus.js";
import { createWebhookHandler } from "../server/collectors/webhook.js";

/**
 * These tests drive the handler with tiny fake req/res objects instead of a
 * real HTTP server. The handler only touches req.url/method/headers and the
 * "data"/"end"/"error" events, and res.writeHead/end — all easy to fake.
 */
type FakeReq = IncomingMessage & { destroyed: boolean };

function makeReq(opts: { url?: string; method?: string; headers?: Record<string, string> }): FakeReq {
  const req = new EventEmitter() as unknown as FakeReq;
  req.url = opts.url ?? "/hooks/sand";
  req.method = opts.method ?? "POST";
  req.headers = opts.headers ?? {};
  req.destroyed = false;
  (req as unknown as { destroy: () => void }).destroy = () => {
    req.destroyed = true;
  };
  return req;
}

type Captured = { status: number; body: string };

function makeRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: "" };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(chunk?: string) {
      if (chunk) captured.body += chunk;
      return res;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

/** Send a request body through the handler and return the captured response. */
function send(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  opts: { url?: string; method?: string; headers?: Record<string, string>; body?: string },
): Captured {
  const req = makeReq(opts);
  const { res, captured } = makeRes();
  handler(req, res);
  if (opts.body !== undefined) req.emit("data", Buffer.from(opts.body, "utf8"));
  req.emit("end");
  return captured;
}

describe("createWebhookHandler", () => {
  const original = process.env.WEBHOOK_SECRET;
  let bus: Bus;

  beforeEach(() => {
    bus = new Bus();
    delete process.env.WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = original;
  });

  it("accepts a valid passthrough payload and publishes it", () => {
    const handler = createWebhookHandler(bus);
    const captured = send(handler, {
      url: "/hooks/sand",
      body: JSON.stringify({ agentId: "sand-1", source: "chatgtm", species: "leafmon", nickname: "Sandy", state: "working" }),
    });

    expect(captured.status).toBe(202);
    expect(JSON.parse(captured.body)).toEqual({ accepted: true });
    expect(bus.getAgent("sand-1")).toMatchObject({ state: "working", nickname: "Sandy" });
  });

  it("returns 200 accepted:false when the adapter ignores the payload", () => {
    const handler = createWebhookHandler(bus);
    // claude adapter returns null for an unknown event.
    const captured = send(handler, {
      url: "/hooks/claude",
      body: JSON.stringify({ hook_event_name: "Notification", session_id: "s" }),
    });
    expect(captured.status).toBe(200);
    expect(JSON.parse(captured.body)).toEqual({ accepted: false });
  });

  it("enforces WEBHOOK_SECRET via the X-Daycare-Secret header", () => {
    process.env.WEBHOOK_SECRET = "s3cret";
    const handler = createWebhookHandler(bus);

    // Missing header -> 401.
    expect(send(handler, { url: "/hooks/sand", body: "{}" }).status).toBe(401);
    // Wrong header -> 401.
    expect(send(handler, { url: "/hooks/sand", headers: { "x-daycare-secret": "nope" }, body: "{}" }).status).toBe(401);
    // Correct header -> processed (empty object is ignored by passthrough -> 200).
    expect(send(handler, { url: "/hooks/sand", headers: { "x-daycare-secret": "s3cret" }, body: "{}" }).status).toBe(200);
  });

  it("returns 400 on malformed JSON and never publishes", () => {
    const handler = createWebhookHandler(bus);
    const captured = send(handler, { url: "/hooks/sand", body: "{not json" });
    expect(captured.status).toBe(400);
    expect(JSON.parse(captured.body)).toEqual({ error: "invalid JSON" });
  });

  it("returns 400 for valid JSON that is not an object", () => {
    const handler = createWebhookHandler(bus);
    expect(send(handler, { url: "/hooks/sand", body: "[1,2,3]" }).status).toBe(400);
    expect(send(handler, { url: "/hooks/sand", body: '"hello"' }).status).toBe(400);
  });

  it("rejects overly large bodies with 413", () => {
    const handler = createWebhookHandler(bus);
    const req = makeReq({ url: "/hooks/sand" });
    const { res, captured } = makeRes();
    handler(req, res);
    req.emit("data", Buffer.from("x".repeat(64 * 1024 + 1), "utf8"));
    expect(captured.status).toBe(413);
    expect(req.destroyed).toBe(true);
  });

  it("only accepts POST", () => {
    const handler = createWebhookHandler(bus);
    expect(send(handler, { url: "/hooks/sand", method: "GET", body: "{}" }).status).toBe(404);
    expect(send(handler, { url: "/hooks/sand", method: "PUT", body: "{}" }).status).toBe(404);
  });

  it("404s unknown/malformed paths", () => {
    const handler = createWebhookHandler(bus);
    expect(send(handler, { url: "/nope", body: "{}" }).status).toBe(404);
    expect(send(handler, { url: "/hooks/", body: "{}" }).status).toBe(404);
  });
});
