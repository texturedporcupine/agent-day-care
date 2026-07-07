import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import { Bus } from "./bus.js";
import { penConfigSchema, type PenConfig } from "../shared/schema.js";
import { startMockCollector } from "./collectors/mock.js";

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

const httpServer = createServer((_req, res) => {
  res.writeHead(404).end();
});

const bus = new Bus(httpServer);
bus.registerPens(loadPens());

const mockEnabled = process.env.MOCK ? process.env.MOCK === "1" : true;
if (mockEnabled) startMockCollector(bus);

httpServer.listen(PORT, () => {
  console.log(`[main] bus listening on ws://localhost:${PORT}`);
});
