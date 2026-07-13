import type { AgentEvent } from "@shared/schema";
import type { ConnectionState } from "./net";

const el = (id: string) => document.getElementById(id)!;

/** Updates the DOM status bar above the Phaser canvas. */
export function updateStatusBar(agents: Map<string, AgentEvent>): void {
  let working = 0;
  let napping = 0;
  let fainted = 0;
  let tokens = 0;
  for (const agent of agents.values()) {
    if (agent.state === "working") working++;
    if (agent.state === "napping") napping++;
    if (agent.state === "fainted") fainted++;
    tokens += agent.tokens ?? 0;
  }
  el("count-working").textContent = String(working);
  el("count-napping").textContent = String(napping);
  el("count-fainted").textContent = String(fainted);
  el("count-tokens").textContent = tokens.toLocaleString();
}

export function setConnectionStatus(state: ConnectionState): void {
  const status = el("conn-status");
  switch (state) {
    case "connected":
      status.textContent = "● live";
      status.style.color = "#a7f070";
      break;
    case "connecting":
      status.textContent = "○ connecting…";
      status.style.color = "#ffcd75";
      break;
    case "disconnected":
      status.textContent = "○ reconnecting…";
      status.style.color = "#ef7d57";
      break;
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
    }
  }
}

/**
 * Shows a centered message over the empty yard so it never sits silent: while
 * the bus is offline, and once connected but before any creature has arrived.
 */
export function updateEmptyState(agentCount: number, state: ConnectionState): void {
  const empty = el("empty-state");
  if (agentCount > 0) {
    empty.classList.add("hidden");
    return;
  }
  empty.classList.remove("hidden");
  switch (state) {
    case "connected":
      empty.textContent = "no agents yet — the day care is quiet";
      break;
    case "connecting":
      empty.textContent = "connecting to the bus…";
      break;
    case "disconnected":
      empty.textContent = "bus offline — reconnecting…";
      break;
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
    }
  }
}
