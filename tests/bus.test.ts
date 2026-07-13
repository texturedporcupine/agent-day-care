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
});
