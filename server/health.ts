import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bus } from "./bus.js";
import type { StateStore } from "./store.js";

export type HealthDeps = {
  bus: Bus;
  /** Names of enabled collectors, e.g. ["cursor-cloud", "webhooks"]. No secrets. */
  collectors: string[];
  /** The persistence store, or null when persistence is disabled. */
  store: StateStore | null;
  /** Process start time (ms epoch) for uptime. */
  startedAt: number;
};

/** Build the /healthz JSON body. Pure and secret-free so it is easy to test. */
export function buildHealth(deps: HealthDeps): Record<string, unknown> {
  const { bus, collectors, store, startedAt } = deps;
  const persistence = store
    ? { enabled: true, path: store.path, ...pickStatus(store) }
    : { enabled: false };
  return {
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    browsers: bus.browserCount(),
    agents: bus.agentCount(),
    collectors,
    persistence,
  };
}

function pickStatus(store: StateStore): { saves: number; lastError: string | null } {
  const { saves, lastError } = store.status();
  return { saves, lastError };
}

/** GET /healthz -> the health JSON; anything else on the route is 405. */
export function createHealthHandler(deps: HealthDeps) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(JSON.stringify(buildHealth(deps)));
  };
}
