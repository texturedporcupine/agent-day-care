import { describe, it, expect } from "vitest";
import { Bus } from "../server/bus.js";
import { buildHealth } from "../server/health.js";
import type { StateStore } from "../server/store.js";

/** A minimal StateStore stand-in — buildHealth only reads `path` and status(). */
function fakeStore(over: Partial<ReturnType<StateStore["status"]>> & { path: string }): StateStore {
  return {
    path: over.path,
    status: () => ({ path: over.path, saves: over.saves ?? 0, lastError: over.lastError ?? null }),
  } as unknown as StateStore;
}

describe("buildHealth", () => {
  it("reports status, agent count, collectors, and persistence", () => {
    const bus = new Bus();
    bus.publish({ agentId: "a1", source: "sand", state: "working", ts: 1 });
    bus.publish({ agentId: "a2", source: "claude", state: "napping", ts: 2 });

    const health = buildHealth({
      bus,
      collectors: ["ingest", "webhooks"],
      store: fakeStore({ path: "/data/state.json", saves: 3 }),
      startedAt: Date.now() - 5000,
    });

    expect(health.status).toBe("ok");
    expect(health.agents).toBe(2);
    expect(health.browsers).toBe(0); // transport-less bus
    expect(health.collectors).toEqual(["ingest", "webhooks"]);
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(4);
    expect(health.persistence).toEqual({
      enabled: true,
      path: "/data/state.json",
      saves: 3,
      lastError: null,
    });
  });

  it("reports persistence disabled when there is no store", () => {
    const health = buildHealth({
      bus: new Bus(),
      collectors: ["ingest", "mock"],
      store: null,
      startedAt: Date.now(),
    });
    expect(health.persistence).toEqual({ enabled: false });
    expect(health.agents).toBe(0);
  });

  it("surfaces a persistence error without leaking secrets", () => {
    const health = buildHealth({
      bus: new Bus(),
      collectors: ["ingest"],
      store: fakeStore({ path: "/data/state.json", lastError: "save failed: EACCES" }),
      startedAt: Date.now(),
    });
    expect((health.persistence as { lastError: string }).lastError).toContain("EACCES");
  });
});
