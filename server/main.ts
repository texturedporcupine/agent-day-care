import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Bus } from "./bus.js";
import { penConfigSchema, type PenConfig } from "../shared/schema.js";
import { startMockCollector } from "./collectors/mock.js";
import { startCursorCloudCollector } from "./collectors/cursorCloud.js";
import { startCursorCliCollector } from "./collectors/cursorCli.js";
import { createWebhookHandler } from "./collectors/webhook.js";
import { createIngestHandler } from "./http/ingest.js";
import { createStaticHandler } from "./static.js";
import { StateStore } from "./store.js";
import { createHealthHandler } from "./health.js";

// PORT is the conventional name; BUS_PORT stays as the historical alias.
const PORT = Number(process.env.PORT ?? process.env.BUS_PORT ?? 8787);
// Bind loopback-only by default so the dashboard stays local; set HOST=0.0.0.0
// (the Docker image does) to accept container/LAN traffic — protect it then.
const HOST = process.env.HOST ?? "127.0.0.1";

// The built client (dist/) lives next to server/ (native tsx) or next to the
// server bundle (dist-server/) in Docker once the build has run.
const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));
const CONFIG_PATH = fileURLToPath(new URL("../daycare.config.json", import.meta.url));

function loadPens(): PenConfig[] {
  if (!existsSync(CONFIG_PATH)) return [];
  try {
    const pens = z.array(penConfigSchema).parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
    console.log(`[main] registered ${pens.length} pens from daycare.config.json`);
    return pens;
  } catch (err) {
    console.warn("[main] ignoring invalid daycare.config.json:", err);
    return [];
  }
}

const webhooksEnabled = process.env.WEBHOOKS === "1";
const persistEnabled = process.env.PERSIST !== "0";
const cursorCloudEnabled = Boolean(process.env.CURSOR_API_KEY);
const cursorCliEnabled = process.env.CURSOR_CLI === "1";
const anyRealSource = cursorCloudEnabled || cursorCliEnabled || webhooksEnabled;
const mockEnabled = process.env.MOCK ? process.env.MOCK === "1" : !anyRealSource;

function enabledCollectors(): string[] {
  const names: string[] = ["ingest"]; // /api/events is always mounted.
  if (webhooksEnabled) names.push("webhooks");
  if (cursorCloudEnabled) names.push("cursor-cloud");
  if (cursorCliEnabled) names.push("cursor-cli");
  if (mockEnabled) names.push("mock");
  return names;
}

// Serve the built client from the same server when it exists. In `npm run dev`
// the client is served by Vite (5173) instead, so a missing dist/ is expected.
const serveStatic = existsSync(DIST_DIR) ? createStaticHandler(DIST_DIR) : null;

// Persistence: an atomic, debounced JSON snapshot of the latest agent state.
const store = persistEnabled ? new StateStore() : null;
const startedAt = Date.now();

const bus = new Bus({ onChange: store ? (agents) => store.scheduleSave(agents) : undefined });
// Recover persisted state before any collector can publish over it. hydrate()
// does not fire onChange, so this never rewrites what we just read.
if (store) {
  bus.hydrate(store.load());
  console.log(`[store] state file: ${store.path} (${bus.agentCount()} agents restored)`);
}

const webhookHandler = createWebhookHandler(bus);
const ingestHandler = createIngestHandler(bus);
const healthHandler = createHealthHandler({ bus, collectors: enabledCollectors(), store, startedAt });

const httpServer = createServer((req, res) => {
  const path = req.url?.split(/[?#]/, 1)[0] ?? "/";
  if (path === "/healthz") {
    healthHandler(req, res);
    return;
  }
  if (path === "/api/events") {
    ingestHandler(req, res);
    return;
  }
  if (webhooksEnabled && path.startsWith("/hooks/")) {
    webhookHandler(req, res);
    return;
  }
  if (serveStatic) {
    serveStatic(req, res);
    return;
  }
  res.writeHead(404).end();
});

// Attach the WebSocket transport now that the http server exists.
bus.attach(httpServer);
bus.registerPens(loadPens());

if (mockEnabled) startMockCollector(bus);
if (cursorCloudEnabled) startCursorCloudCollector(bus);
if (cursorCliEnabled) startCursorCliCollector(bus);
if (webhooksEnabled) console.log("[webhook] collector listening on POST /hooks/:sourceId");

console.log("[ingest] canonical endpoint listening on POST /api/events");
if (!process.env.INGEST_TOKEN) {
  console.warn(
    "[ingest] INGEST_TOKEN not set — /api/events accepts UNAUTHENTICATED requests from " +
      "loopback only; non-loopback callers are rejected. Set INGEST_TOKEN to allow remote ingest.",
  );
  if (HOST !== "127.0.0.1" && HOST !== "::1" && HOST !== "localhost") {
    console.warn(
      `[ingest] HOST=${HOST} exposes this server beyond loopback without an ingest token; ` +
        "set INGEST_TOKEN and restrict access (tunnel/firewall).",
    );
  }
}

// Persist the final snapshot on shutdown so the last events aren't lost to the
// debounce window.
function shutdown(signal: string): void {
  console.log(`[main] ${signal} received, flushing state...`);
  store?.flush();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

httpServer.listen(PORT, HOST, () => {
  if (serveStatic) {
    console.log(`[main] dashboard + bus on http://${HOST}:${PORT}`);
  } else {
    console.log(`[main] bus listening on ws://${HOST}:${PORT}`);
    console.log("[main] no dist/ found — run `npm run build && npm start` to serve the client here");
  }
});
