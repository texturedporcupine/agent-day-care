import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore, isPersistable, resolveStatePath } from "../server/store.js";
import type { AgentEvent } from "../shared/schema.js";

function agent(over: Partial<AgentEvent> & { agentId: string }): AgentEvent {
  return {
    source: "sand",
    species: "sparkmon",
    nickname: over.agentId,
    state: "working",
    ts: 1,
    ...over,
  };
}

describe("resolveStatePath", () => {
  it("joins DATA_DIR and STATE_FILE, defaulting sensibly", () => {
    expect(resolveStatePath({ DATA_DIR: "/data", STATE_FILE: "s.json" })).toBe("/data/s.json");
    expect(resolveStatePath({})).toMatch(/data[/\\]state\.json$/);
  });

  it("honors an absolute STATE_FILE outright", () => {
    expect(resolveStatePath({ DATA_DIR: "/ignored", STATE_FILE: "/abs/state.json" })).toBe("/abs/state.json");
  });
});

describe("isPersistable", () => {
  it("excludes mock- prefixed agents so the demo never pollutes real state", () => {
    expect(isPersistable(agent({ agentId: "sand-1" }))).toBe(true);
    expect(isPersistable(agent({ agentId: "mock-cloud-1" }))).toBe(false);
  });
});

describe("StateStore", () => {
  let dir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "daycare-store-"));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] when no state file exists yet", () => {
    const store = new StateStore({ path: join(dir, "state.json") });
    expect(store.load()).toEqual([]);
  });

  it("round-trips agents across a save + reload", () => {
    const path = join(dir, "state.json");
    const write = new StateStore({ path, debounceMs: 0 });
    write.scheduleSave([agent({ agentId: "a1", state: "working" }), agent({ agentId: "a2", state: "napping" })]);
    write.flush();

    const read = new StateStore({ path });
    const loaded = read.load();
    expect(loaded).toHaveLength(2);
    expect(loaded.find((a) => a.agentId === "a1")).toMatchObject({ state: "working" });
  });

  it("excludes mock agents from the persisted snapshot", () => {
    const path = join(dir, "state.json");
    const store = new StateStore({ path });
    store.scheduleSave([agent({ agentId: "real-1" }), agent({ agentId: "mock-1" })]);
    store.flush();

    const loaded = new StateStore({ path }).load();
    expect(loaded.map((a) => a.agentId)).toEqual(["real-1"]);
  });

  it("debounces writes: nothing on disk until the window elapses or flush()", () => {
    const path = join(dir, "state.json");
    const store = new StateStore({ path, debounceMs: 10_000 });
    store.scheduleSave([agent({ agentId: "a1" })]);
    // Debounced: the file must not exist synchronously after scheduling.
    expect(existsSync(path)).toBe(false);
    store.flush();
    expect(existsSync(path)).toBe(true);
    expect(store.status().saves).toBe(1);
  });

  it("coalesces a burst into a single write of the latest state", () => {
    const path = join(dir, "state.json");
    const store = new StateStore({ path, debounceMs: 10_000 });
    store.scheduleSave([agent({ agentId: "a1", state: "egg" })]);
    store.scheduleSave([agent({ agentId: "a1", state: "thinking" })]);
    store.scheduleSave([agent({ agentId: "a1", state: "working" })]);
    store.flush();

    expect(store.status().saves).toBe(1);
    const loaded = new StateStore({ path }).load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ agentId: "a1", state: "working" });
  });

  it("leaves no .tmp file behind and writes valid JSON", () => {
    const path = join(dir, "state.json");
    const store = new StateStore({ path, debounceMs: 0 });
    store.scheduleSave([agent({ agentId: "a1" })]);
    store.flush();
    expect(existsSync(`${path}.tmp.${process.pid}`)).toBe(false);
    expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
  });

  it("recovers from a corrupt (non-JSON) state file by quarantining it", () => {
    const path = join(dir, "state.json");
    writeFileSync(path, "{ this is not json", "utf8");
    const store = new StateStore({ path });

    expect(store.load()).toEqual([]);
    expect(existsSync(`${path}.corrupt`)).toBe(true);
    expect(readFileSync(`${path}.corrupt`, "utf8")).toContain("not json");
  });

  it("recovers from a valid-JSON-but-wrong-shape state file", () => {
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify({ nope: true }), "utf8");
    expect(new StateStore({ path }).load()).toEqual([]);
    expect(existsSync(`${path}.corrupt`)).toBe(true);
  });

  it("drops individually invalid records but keeps valid ones", () => {
    const path = join(dir, "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        agents: [
          agent({ agentId: "good" }),
          { agentId: "bad", state: "flying" }, // invalid enum
          { nickname: "no-id" }, // missing agentId
        ],
      }),
      "utf8",
    );
    const loaded = new StateStore({ path }).load();
    expect(loaded.map((a) => a.agentId)).toEqual(["good"]);
  });

  it("accepts a bare top-level array for forward/backward tolerance", () => {
    const path = join(dir, "state.json");
    writeFileSync(path, JSON.stringify([agent({ agentId: "a1" })]), "utf8");
    expect(new StateStore({ path }).load().map((a) => a.agentId)).toEqual(["a1"]);
  });
});
