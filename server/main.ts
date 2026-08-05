import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { Bus } from "./bus.js";
import { loadTaskMemory, saveTaskMemory } from "./taskStore.js";
import { penConfigSchema, type PenConfig } from "../shared/schema.js";
import { startMockCollector } from "./collectors/mock.js";
import { startCursorCloudCollector } from "./collectors/cursorCloud.js";
import { startCursorCliCollector } from "./collectors/cursorCli.js";
import { createWebhookHandler } from "./collectors/webhook.js";

// Collectors read process.env lazily, so loading here covers all of them.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
  console.log("[main] loaded .env");
} catch {
  // No .env file; rely on the ambient environment.
}

const PORT = Number(process.env.BUS_PORT ?? 8787);

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

const httpServer = createServer((req, res) => {
  if (webhooksEnabled && req.url?.startsWith("/hooks/")) {
    webhookHandler(req, res);
    return;
  }
  res.writeHead(404).end();
});

const taskMemory = loadTaskMemory();
const bus = new Bus(httpServer, taskMemory, () => saveTaskMemory(taskMemory));
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
  console.log(`[main] bus listening on ws://localhost:${PORT}`);
});
