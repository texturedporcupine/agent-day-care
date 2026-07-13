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
import { createStaticHandler } from "./static.js";

// PORT is the conventional name; BUS_PORT stays as the historical alias.
const PORT = Number(process.env.PORT ?? process.env.BUS_PORT ?? 8787);

// The built client (dist/) lives next to server/ once `npm run build` has run.
const DIST_DIR = fileURLToPath(new URL("../dist", import.meta.url));

function loadPens(): PenConfig[] {
  const path = new URL("../daycare.config.json", import.meta.url).pathname;
  if (!existsSync(path)) return [];
  try {
    const pens = z.array(penConfigSchema).parse(JSON.parse(readFileSync(path, "utf8")));
    console.log(`[main] registered ${pens.length} pens from daycare.config.json`);
    return pens;
  } catch (err) {
    console.warn("[main] ignoring invalid daycare.config.json:", err);
    return [];
  }
}

const webhooksEnabled = process.env.WEBHOOKS === "1";

// Serve the built client from the same server when it exists. In `npm run dev`
// the client is served by Vite (5173) instead, so a missing dist/ is expected.
const distExists = existsSync(DIST_DIR);
const serveStatic = distExists ? createStaticHandler(DIST_DIR) : null;

const httpServer = createServer((req, res) => {
  if (webhooksEnabled && req.url?.startsWith("/hooks/")) {
    webhookHandler(req, res);
    return;
  }
  if (serveStatic) {
    serveStatic(req, res);
    return;
  }
  res.writeHead(404).end();
});

const bus = new Bus(httpServer);
const webhookHandler = createWebhookHandler(bus);
bus.registerPens(loadPens());

const cursorCloudEnabled = Boolean(process.env.CURSOR_API_KEY);
const cursorCliEnabled = process.env.CURSOR_CLI === "1";
const anyRealSource = cursorCloudEnabled || cursorCliEnabled || webhooksEnabled;
const mockEnabled = process.env.MOCK ? process.env.MOCK === "1" : !anyRealSource;

if (mockEnabled) startMockCollector(bus);
if (cursorCloudEnabled) startCursorCloudCollector(bus);
if (cursorCliEnabled) startCursorCliCollector(bus);
if (webhooksEnabled) console.log("[webhook] collector listening on POST /hooks/:sourceId");

httpServer.listen(PORT, () => {
  if (serveStatic) {
    console.log(`[main] dashboard + bus on http://localhost:${PORT}`);
  } else {
    console.log(`[main] bus listening on ws://localhost:${PORT}`);
    console.log("[main] no dist/ found — run `npm run build && npm start` to serve the client here");
  }
});
