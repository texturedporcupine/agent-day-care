import type { AgentEvent, CreatureState } from "@shared/schema";
import type { ConnectionState } from "./net";

const el = (id: string) => document.getElementById(id)!;

const STATE_PRIORITY: Record<CreatureState, number> = {
  fainted: 0,
  levelup: 1,
  working: 2,
  thinking: 3,
  egg: 4,
  napping: 5,
};

const STATE_COLOR: Record<CreatureState, string> = {
  fainted: "#ef7d57",
  levelup: "#c17be8",
  working: "#a7f070",
  thinking: "#ffcd75",
  egg: "#f4f4f4",
  napping: "#73eff7",
};

/** Updates the DOM status bar above the Phaser canvas. */
export function updateStatusBar(agents: Map<string, AgentEvent>): void {
  let thinking = 0;
  let working = 0;
  let levelup = 0;
  let napping = 0;
  let fainted = 0;
  let tokens = 0;
  for (const agent of agents.values()) {
    if (agent.state === "thinking") thinking++;
    if (agent.state === "working") working++;
    if (agent.state === "levelup") levelup++;
    if (agent.state === "napping") napping++;
    if (agent.state === "fainted") fainted++;
    tokens += agent.tokens ?? 0;
  }
  el("count-thinking").textContent = String(thinking);
  el("count-working").textContent = String(working);
  el("count-levelup").textContent = String(levelup);
  el("count-napping").textContent = String(napping);
  el("count-fainted").textContent = String(fainted);
  el("count-tokens").textContent = tokens.toLocaleString();
}

/** Renders the operational thread list, ordered by what needs attention first. */
export function updateThreadList(agents: Map<string, AgentEvent>): void {
  const threadList = el("thread-list");
  const empty = el("threads-empty");
  const sortedAgents = [...agents.values()].sort(
    (a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] || b.ts - a.ts,
  );

  const fragment = document.createDocumentFragment();
  for (const agent of sortedAgents) {
    const card = document.createElement("article");
    card.className = "thread-card";
    card.style.setProperty("--state-color", STATE_COLOR[agent.state]);

    const state = document.createElement("span");
    state.className = "thread-state";
    state.title = agent.state;

    const name = document.createElement(agent.url ? "a" : "span");
    name.className = "thread-name";
    name.textContent = agent.nickname;
    if (name instanceof HTMLAnchorElement && agent.url) {
      name.href = agent.url;
      name.target = "_blank";
      name.rel = "noreferrer";
      name.title = `Open ${agent.nickname}'s session`;
    }

    const meta = document.createElement("span");
    meta.className = "thread-meta";
    meta.textContent = `${agent.state} · ${agent.source}`;

    const activity = document.createElement("span");
    activity.className = "thread-activity";
    activity.textContent = agent.activity ?? "Waiting for an update";
    activity.title = agent.activity ?? "";

    card.append(state, name, meta, activity);

    if (agent.branch || agent.prUrl) {
      const links = document.createElement("span");
      links.className = "thread-links";
      if (agent.branch) {
        const branch = document.createElement("span");
        branch.className = "thread-branch";
        branch.textContent = agent.branch;
        branch.title = agent.branch;
        links.append(branch);
      }
      if (agent.prUrl) {
        const pr = document.createElement("a");
        pr.href = agent.prUrl;
        pr.target = "_blank";
        pr.rel = "noreferrer";
        pr.textContent = "PR ↗";
        links.append(pr);
      }
      card.append(links);
    }

    fragment.append(card);
  }

  threadList.replaceChildren(fragment);
  el("thread-total").textContent = `${agents.size} ${agents.size === 1 ? "thread" : "threads"}`;
  empty.classList.toggle("hidden", agents.size > 0);
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
