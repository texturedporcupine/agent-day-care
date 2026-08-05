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
export type TaskMemoryEntry = { mission?: string; task?: string };

export class Bus {
  private agents = new Map<string, AgentEvent>();
  private wss: WebSocketServer | null = null;
  private taskMemory: Record<string, TaskMemoryEntry>;
  private onTaskChange: (() => void) | undefined;

  /**
   * Pass an http server to attach the WebSocket transport (production). Omit it
   * to construct a transport-less bus for unit tests — the state store, merge,
   * and validation behavior are identical; broadcast simply becomes a no-op.
   */
  constructor(
    httpServer?: HttpServer,
    taskMemory: Record<string, TaskMemoryEntry> = {},
    onTaskChange?: () => void,
  ) {
    this.taskMemory = taskMemory;
    this.onTaskChange = onTaskChange;
    if (!httpServer) return;
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
    const remembered = this.taskMemory[parsed.data.agentId];
    const merged: AgentEvent = {
      // Defaults for agents that show up without a registered pen.
      source: "cursor-cloud",
      species: "sparkmon",
      nickname: parsed.data.agentId,
      state: "egg",
      ts: Date.now(),
      // Asks remembered from a previous run of the server.
      ...(remembered ?? {}),
      ...prev,
      ...parsed.data,
    };
    // First ask ever seen for this thread becomes its mission.
    if (!merged.mission && merged.task) merged.mission = merged.task;
    // Track when the agent entered its current state, for "waiting 25m" labels.
    merged.stateSince = prev && prev.state === merged.state ? prev.stateSince : merged.ts;
    this.agents.set(merged.agentId, merged);
    this.rememberTasks(merged);
    this.broadcast({ type: "diff", agent: merged });
  }

  private rememberTasks(agent: AgentEvent): void {
    if (!agent.task && !agent.mission) return;
    const entry = this.taskMemory[agent.agentId];
    if (entry?.task === agent.task && entry?.mission === agent.mission) return;
    this.taskMemory[agent.agentId] = { mission: agent.mission, task: agent.task };
    this.onTaskChange?.();
  }

  getAgent(agentId: string): AgentEvent | undefined {
    return this.agents.get(agentId);
  }

  private broadcast(message: BusMessage): void {
    if (!this.wss) return;
    const payload = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }
}
