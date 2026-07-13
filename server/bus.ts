import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import {
  agentEventPatchSchema,
  type AgentEvent,
  type AgentEventPatch,
  type BusMessage,
  type PenConfig,
} from "../shared/schema.js";

/** Optional hooks; keeps the bus decoupled from transport and persistence. */
export type BusOptions = {
  /** Called after any state change with the full agent list (for persistence). */
  onChange?: (agents: AgentEvent[]) => void;
};

/**
 * Holds the current state of every agent and pushes JSON diffs to browsers.
 * Collectors call publish() with partial updates; the bus validates, merges
 * into the last known state, and broadcasts.
 */
export class Bus {
  private agents = new Map<string, AgentEvent>();
  private wss: WebSocketServer | null = null;
  private onChange: BusOptions["onChange"];

  /**
   * A bus with no transport attached: the state store, merge, and validation
   * behavior are fully usable (broadcast is a no-op), which is exactly what unit
   * tests want. Production calls attach() once the http server exists.
   */
  constructor(options: BusOptions = {}) {
    this.onChange = options.onChange;
  }

  /**
   * Attach the WebSocket transport to a live http server. Kept separate from the
   * constructor so main.ts can build the bus, hydrate persisted state, and only
   * then create the http server + attach — no circular construction order.
   */
  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer });
    this.wss.on("connection", (socket) => {
      const snapshot: BusMessage = { type: "snapshot", agents: [...this.agents.values()] };
      socket.send(JSON.stringify(snapshot));
    });
  }

  /**
   * Load previously persisted agents on boot. Unlike publish(), this neither
   * broadcasts (no clients yet) nor fires onChange (avoid rewriting what we just
   * read). Existing entries are never overwritten, so a live collector always
   * wins over stale disk state if both arrive.
   */
  hydrate(agents: AgentEvent[]): void {
    for (const agent of agents) {
      if (!this.agents.has(agent.agentId)) this.agents.set(agent.agentId, agent);
    }
  }

  /** Pre-register pens from daycare.config.json so they render as eggs on boot. */
  registerPens(pens: PenConfig[]): void {
    let changed = false;
    for (const pen of pens) {
      if (this.agents.has(pen.agentId)) continue;
      this.agents.set(pen.agentId, { ...pen, state: "egg", ts: Date.now() });
      changed = true;
    }
    if (changed) this.onChange?.(this.snapshot());
  }

  /**
   * Merge a validated patch into the agent's state and broadcast the result.
   * Invalid patches are logged and dropped so a bad adapter can't break the scene.
   */
  publish(patch: AgentEventPatch): void {
    const parsed = agentEventPatchSchema.safeParse(patch);
    if (!parsed.success) {
      console.warn("[bus] dropped invalid event:", parsed.error.issues, patch);
      return;
    }
    const prev = this.agents.get(parsed.data.agentId);
    const merged: AgentEvent = {
      // Defaults for agents that show up without a registered pen.
      source: "cursor-cloud",
      species: "sparkmon",
      nickname: parsed.data.agentId,
      state: "egg",
      ts: Date.now(),
      ...prev,
      ...parsed.data,
    };
    this.agents.set(merged.agentId, merged);
    this.broadcast({ type: "diff", agent: merged });
    this.onChange?.(this.snapshot());
  }

  getAgent(agentId: string): AgentEvent | undefined {
    return this.agents.get(agentId);
  }

  /** All agents currently tracked (order is insertion order). */
  snapshot(): AgentEvent[] {
    return [...this.agents.values()];
  }

  /** Number of tracked agents (for /healthz). */
  agentCount(): number {
    return this.agents.size;
  }

  /** Number of connected browser WebSocket clients (0 when transport-less). */
  browserCount(): number {
    if (!this.wss) return 0;
    let open = 0;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) open += 1;
    }
    return open;
  }

  private broadcast(message: BusMessage): void {
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
