import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Bus } from "../server/bus.js";
import type { AgentEventPatch, PenConfig } from "../shared/schema.js";

/**
 * The bus is constructed without an http server (see Bus constructor) so these
 * tests exercise the pure state store + merge + validation without a live
 * WebSocket transport. broadcast() becomes a no-op in this mode.
 */
describe("Bus", () => {
  let bus: Bus;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bus = new Bus();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("merges a valid patch into prior state", () => {
    bus.publish({
      agentId: "a1",
      source: "claude",
      species: "aquamon",
      nickname: "Aqua",
      state: "thinking",
      activity: "planning",
      ts: 1,
    });
    bus.publish({ agentId: "a1", state: "working", tool: "read_file", activity: "reading README", ts: 2 });

    const agent = bus.getAgent("a1");
    expect(agent).toMatchObject({
      agentId: "a1",
      source: "claude", // preserved from the earlier patch
      species: "aquamon",
      nickname: "Aqua",
      state: "working", // updated
      tool: "read_file",
      activity: "reading README",
    });
  });

  it("applies defaults for agents that show up without a registered pen", () => {
    bus.publish({ agentId: "loner", state: "working", ts: 1 });

    expect(bus.getAgent("loner")).toMatchObject({
      agentId: "loner",
      source: "cursor-cloud",
      species: "sparkmon",
      nickname: "loner", // defaults to the agentId
      state: "working",
    });
  });

  it("drops invalid patches without throwing or corrupting existing state", () => {
    bus.publish({
      agentId: "a1",
      source: "claude",
      species: "aquamon",
      nickname: "Aqua",
      state: "working",
      ts: 1,
    });

    // Invalid state enum.
    bus.publish({ agentId: "a1", state: "flying" } as unknown as AgentEventPatch);
    // Negative tokens.
    bus.publish({ agentId: "a1", tokens: -5 } as unknown as AgentEventPatch);
    // Missing/empty agentId.
    bus.publish({ agentId: "" } as unknown as AgentEventPatch);

    expect(warn).toHaveBeenCalled();
    // Prior good state is untouched.
    expect(bus.getAgent("a1")).toMatchObject({ state: "working", source: "claude" });
    expect(bus.getAgent("")).toBeUndefined();
  });

  it("does not throw when publishing a completely malformed value", () => {
    expect(() => bus.publish(undefined as unknown as AgentEventPatch)).not.toThrow();
    expect(() => bus.publish({} as unknown as AgentEventPatch)).not.toThrow();
  });

  it("seeds registered pens as eggs", () => {
    const pens: PenConfig[] = [
      { agentId: "p1", source: "claude", species: "aquamon", nickname: "Aqua" },
      { agentId: "p2", source: "chatgtm", species: "leafmon", nickname: "Leaf", url: "https://example.com/p2" },
    ];
    bus.registerPens(pens);

    expect(bus.getAgent("p1")).toMatchObject({ agentId: "p1", state: "egg", species: "aquamon" });
    expect(bus.getAgent("p2")).toMatchObject({ agentId: "p2", state: "egg", url: "https://example.com/p2" });
    expect(typeof bus.getAgent("p1")?.ts).toBe("number");
  });

  it("does not overwrite an existing agent when registering pens", () => {
    bus.publish({
      agentId: "p1",
      source: "claude",
      species: "aquamon",
      nickname: "Aqua",
      state: "working",
      ts: 1,
    });
    bus.registerPens([{ agentId: "p1", source: "claude", species: "aquamon", nickname: "Aqua" }]);

    expect(bus.getAgent("p1")?.state).toBe("working");
  });

  it("tracks stateSince across state changes and keeps it stable within a state", () => {
    bus.publish({ agentId: "a1", state: "working", ts: 100 });
    expect(bus.getAgent("a1")?.stateSince).toBe(100);

    // Same state: stateSince unchanged even as events keep arriving.
    bus.publish({ agentId: "a1", state: "working", activity: "still at it", ts: 200 });
    expect(bus.getAgent("a1")?.stateSince).toBe(100);

    // New state: stateSince resets to that event's ts.
    bus.publish({ agentId: "a1", state: "levelup", ts: 300 });
    expect(bus.getAgent("a1")?.stateSince).toBe(300);
  });

  it("promotes the first task to mission and keeps it as tasks change", () => {
    bus.publish({ agentId: "a1", state: "working", task: "build the dashboard", ts: 1 });
    bus.publish({ agentId: "a1", task: "now fix the tests", ts: 2 });

    expect(bus.getAgent("a1")).toMatchObject({
      mission: "build the dashboard",
      task: "now fix the tests",
    });
  });

  it("restores remembered asks and reports task changes", () => {
    const onTaskChange = vi.fn();
    const memory = { a1: { mission: "original ask", task: "latest ask" } };
    const restoringBus = new Bus(undefined, memory, onTaskChange);

    restoringBus.publish({ agentId: "a1", state: "napping", ts: 1 });
    expect(restoringBus.getAgent("a1")).toMatchObject({
      mission: "original ask",
      task: "latest ask",
    });

    restoringBus.publish({ agentId: "a1", task: "newer ask", ts: 2 });
    expect(memory["a1"]).toEqual({ mission: "original ask", task: "newer ask" });
    expect(onTaskChange).toHaveBeenCalled();
  });
});
