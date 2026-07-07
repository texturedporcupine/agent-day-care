import type { AgentEvent } from "@shared/schema";

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

export function setConnectionStatus(connected: boolean): void {
  const status = el("conn-status");
  status.textContent = connected ? "● live" : "○ reconnecting...";
  status.style.color = connected ? "#a7f070" : "#ef7d57";
}
