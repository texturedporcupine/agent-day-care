import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Bus } from "../server/bus.js";
import { createIngestHandler } from "../server/http/ingest.js";
import { checkIngestAuth, isLoopbackRequest, timingSafeEqualStr } from "../server/http/auth.js";

type FakeReq = IncomingMessage & { destroyed: boolean };

function makeReq(opts: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}): FakeReq {
  const req = new EventEmitter() as unknown as FakeReq;
  req.url = opts.url ?? "/api/events";
  req.method = opts.method ?? "POST";
  req.headers = opts.headers ?? { "content-type": "application/json" };
  req.destroyed = false;
  (req as unknown as { socket: { remoteAddress?: string } }).socket = {
    remoteAddress: opts.remoteAddress ?? "127.0.0.1",
  };
  (req as unknown as { destroy: () => void }).destroy = () => {
    req.destroyed = true;
  };
  return req;
}

type Captured = { status: number; body: string; headers: Record<string, string> };

function makeRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, body: "", headers: {} };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) captured.headers = headers;
      return res;
    },
    end(chunk?: string) {
      if (chunk) captured.body += chunk;
      return res;
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

function send(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  opts: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    remoteAddress?: string;
    body?: string;
  },
): Captured {
  const req = makeReq(opts);
  const { res, captured } = makeRes();
  handler(req, res);
  if (opts.body !== undefined) req.emit("data", Buffer.from(opts.body, "utf8"));
  req.emit("end");
  return captured;
}

const JSON_CT = { "content-type": "application/json" };

describe("createIngestHandler (POST /api/events)", () => {
  const original = process.env.INGEST_TOKEN;
  let bus: Bus;

  beforeEach(() => {
    bus = new Bus();
    delete process.env.INGEST_TOKEN;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.INGEST_TOKEN;
    else process.env.INGEST_TOKEN = original;
  });

  it("accepts a valid patch from loopback with no token and publishes it", () => {
    const handler = createIngestHandler(bus);
    const captured = send(handler, {
      headers: JSON_CT,
      body: JSON.stringify({ agentId: "sand-1", source: "sand", state: "working", nickname: "Sandy" }),
    });
    expect(captured.status).toBe(202);
    expect(JSON.parse(captured.body)).toEqual({ accepted: true, agentId: "sand-1" });
    expect(bus.getAgent("sand-1")).toMatchObject({ state: "working", source: "sand" });
  });

  it("rejects non-loopback requests with 401 when no token is configured", () => {
    const handler = createIngestHandler(bus);
    const captured = send(handler, {
      headers: JSON_CT,
      remoteAddress: "10.0.0.5",
      body: JSON.stringify({ agentId: "x" }),
    });
    expect(captured.status).toBe(401);
    expect(bus.getAgent("x")).toBeUndefined();
  });

  it("requires a matching bearer token when INGEST_TOKEN is set", () => {
    process.env.INGEST_TOKEN = "s3cret";
    const handler = createIngestHandler(bus);

    expect(send(handler, { headers: JSON_CT, body: '{"agentId":"x"}' }).status).toBe(401);
    expect(
      send(handler, {
        headers: { ...JSON_CT, authorization: "Bearer nope" },
        body: '{"agentId":"x"}',
      }).status,
    ).toBe(401);
    // A remote caller with the right token is allowed (that's the point of the token).
    const ok = send(handler, {
      headers: { ...JSON_CT, authorization: "Bearer s3cret" },
      remoteAddress: "10.0.0.5",
      body: JSON.stringify({ agentId: "x", state: "thinking" }),
    });
    expect(ok.status).toBe(202);
    expect(bus.getAgent("x")).toMatchObject({ state: "thinking" });
  });

  it("only accepts POST", () => {
    const handler = createIngestHandler(bus);
    expect(send(handler, { method: "GET" }).status).toBe(405);
    expect(send(handler, { method: "PUT", headers: JSON_CT, body: "{}" }).status).toBe(405);
  });

  it("requires an application/json content type", () => {
    const handler = createIngestHandler(bus);
    const captured = send(handler, { headers: { "content-type": "text/plain" }, body: "{}" });
    expect(captured.status).toBe(415);
  });

  it("returns 400 with zod issues for an invalid patch", () => {
    const handler = createIngestHandler(bus);
    const captured = send(handler, { headers: JSON_CT, body: '{"agentId":"x","state":"flying"}' });
    expect(captured.status).toBe(400);
    expect(JSON.parse(captured.body).error).toBe("invalid AgentEventPatch");
  });

  it("returns 400 for malformed JSON and non-object JSON", () => {
    const handler = createIngestHandler(bus);
    expect(send(handler, { headers: JSON_CT, body: "{nope" }).status).toBe(400);
    expect(send(handler, { headers: JSON_CT, body: "[1,2,3]" }).status).toBe(400);
  });

  it("rejects overly large bodies with 413 and destroys the socket", () => {
    const handler = createIngestHandler(bus);
    const req = makeReq({ headers: JSON_CT });
    const { res, captured } = makeRes();
    handler(req, res);
    req.emit("data", Buffer.from("x".repeat(64 * 1024 + 1), "utf8"));
    expect(captured.status).toBe(413);
    expect(req.destroyed).toBe(true);
  });
});

describe("auth helpers", () => {
  it("timingSafeEqualStr matches equal strings and rejects others (incl. different lengths)", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  it("isLoopbackRequest recognizes loopback addresses only", () => {
    const req = (addr?: string) =>
      ({ socket: { remoteAddress: addr } }) as unknown as IncomingMessage;
    expect(isLoopbackRequest(req("127.0.0.1"))).toBe(true);
    expect(isLoopbackRequest(req("::1"))).toBe(true);
    expect(isLoopbackRequest(req("::ffff:127.0.0.1"))).toBe(true);
    expect(isLoopbackRequest(req("10.0.0.5"))).toBe(false);
    expect(isLoopbackRequest(req(undefined))).toBe(false);
  });

  it("checkIngestAuth: loopback ok without token, remote rejected without token", () => {
    const loopback = { socket: { remoteAddress: "127.0.0.1" }, headers: {} } as unknown as IncomingMessage;
    const remote = { socket: { remoteAddress: "10.0.0.5" }, headers: {} } as unknown as IncomingMessage;
    expect(checkIngestAuth(loopback, undefined)).toEqual({ ok: true });
    expect(checkIngestAuth(remote, undefined).ok).toBe(false);
  });

  it("checkIngestAuth: with a token, only the matching bearer passes", () => {
    const withHeader = (auth?: string) =>
      ({ socket: { remoteAddress: "10.0.0.5" }, headers: auth ? { authorization: auth } : {} }) as unknown as IncomingMessage;
    expect(checkIngestAuth(withHeader("Bearer tok"), "tok")).toEqual({ ok: true });
    expect(checkIngestAuth(withHeader("Bearer nope"), "tok").ok).toBe(false);
    expect(checkIngestAuth(withHeader(undefined), "tok").ok).toBe(false);
  });
});
