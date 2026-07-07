import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import {
  agentEventPatchSchema,
  type AgentEvent,
  type AgentEventPatch,
  type BusMessage,
  type PenConfig,
} from "../shared/schema.js";

/**
 * Holds the current state of every agent and pushes JSON diffs to browsers.
 * Collectors call publish() with partial updates; the bus validates, merges
 * into the last known state, and broadcasts.
 */
export class Bus {
  private agents = new Map<string, AgentEvent>();
  private wss: WebSocketServer;

  constructor(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.wss.on("connection", (socket) => {
      const snapshot: BusMessage = { type: "snapshot", agents: [...this.agents.values()] };
      socket.send(JSON.stringify(snapshot));
    });
  }

  /** Pre-register pens from daycare.config.json so they render as eggs on boot. */
  registerPens(pens: PenConfig[]): void {
    for (const pen of pens) {
      if (this.agents.has(pen.agentId)) continue;
      this.agents.set(pen.agentId, { ...pen, state: "egg", ts: Date.now() });
    }
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
  }

  getAgent(agentId: string): AgentEvent | undefined {
    return this.agents.get(agentId);
  }

  private broadcast(message: BusMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
