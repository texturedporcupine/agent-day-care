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
  fainted: "#f05868",
  levelup: "#c880e8",
  working: "#78d048",
  thinking: "#f8c850",
  egg: "#a0b0bc",
  napping: "#58c8e8",
};

type Bucket = "needs-you" | "running" | "idle";

const BUCKET_LABEL: Record<Bucket, string> = {
  "needs-you": "Needs you",
  running: "Running",
  idle: "Idle",
};

function bucketOf(agent: AgentEvent): Bucket {
  if (agent.state === "fainted" || agent.state === "levelup") return "needs-you";
  if (agent.state === "napping") return "idle";
  return "running";
}

/** Dismissals are keyed by agent + stateSince, so a new event un-dismisses. */
const dismissKey = (agent: AgentEvent) => `daycare-dismissed:${agent.agentId}`;

function isDismissed(agent: AgentEvent): boolean {
  return localStorage.getItem(dismissKey(agent)) === String(agent.stateSince ?? "");
}

function dismiss(agent: AgentEvent): void {
  localStorage.setItem(dismissKey(agent), String(agent.stateSince ?? ""));
  if (lastAgents) updateThreadList(lastAgents);
}

let repoFilter: string | null = null;
let lastAgents: Map<string, AgentEvent> | null = null;
/** Last state seen per agent, to notify only on transitions into needs-you. */
const seenStates = new Map<string, CreatureState>();

function relTime(since: number | undefined): string {
  if (!since) return "";
  const mins = Math.floor((Date.now() - since) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

function maybeNotify(agent: AgentEvent): void {
  const prev = seenStates.get(agent.agentId);
  seenStates.set(agent.agentId, agent.state);
  // Only notify on a transition observed while the page is open.
  if (prev === undefined || prev === agent.state) return;
  if (bucketOf(agent) !== "needs-you") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const verb = agent.state === "fainted" ? "hit an error" : "finished — needs review";
  new Notification(`${agent.nickname} ${verb}`, {
    body: agent.activity ?? agent.task ?? "",
    tag: agent.agentId,
  });
}

function updateTabTitle(needsYou: number): void {
  document.title = needsYou > 0 ? `(${needsYou}) Agent Day Care` : "Agent Day Care";
}

/** The bell button asks for notification permission (needs a user gesture). */
export function initNotifications(): void {
  const bell = el("notify-toggle");
  if (!("Notification" in window)) {
    bell.style.display = "none";
    return;
  }
  const sync = () => {
    bell.textContent = Notification.permission === "granted" ? "🔔 on" : "🔔 notify";
    bell.classList.toggle("enabled", Notification.permission === "granted");
  };
  bell.addEventListener("click", () => {
    void Notification.requestPermission().then(sync);
  });
  sync();
}

/** Re-render every 30s so the "waiting 25m" labels stay honest. */
setInterval(() => {
  if (lastAgents) updateThreadList(lastAgents);
}, 30_000);

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

/** Renders the operational thread list, bucketed by what needs attention. */
export function updateThreadList(agents: Map<string, AgentEvent>): void {
  lastAgents = agents;
  const threadList = el("thread-list");
  const empty = el("threads-empty");

  for (const agent of agents.values()) maybeNotify(agent);

  const visible = [...agents.values()].filter((a) => !repoFilter || a.repo === repoFilter);
  const buckets: Record<Bucket, AgentEvent[]> = { "needs-you": [], running: [], idle: [] };
  for (const agent of visible) {
    if (bucketOf(agent) === "needs-you" && isDismissed(agent)) buckets.idle.push(agent);
    else buckets[bucketOf(agent)].push(agent);
  }
  // Longest-waiting first in "needs you"; most recently active first elsewhere.
  buckets["needs-you"].sort((a, b) => (a.stateSince ?? 0) - (b.stateSince ?? 0));
  buckets.running.sort((a, b) => STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] || b.ts - a.ts);
  buckets.idle.sort((a, b) => b.ts - a.ts);

  updateTabTitle(buckets["needs-you"].length);

  const fragment = document.createDocumentFragment();
  for (const bucket of ["needs-you", "running", "idle"] as const) {
    if (buckets[bucket].length === 0) continue;
    const heading = document.createElement("div");
    heading.className = `bucket-heading bucket-${bucket}`;
    heading.textContent = `${BUCKET_LABEL[bucket]} · ${buckets[bucket].length}`;
    fragment.append(heading);
    for (const agent of buckets[bucket]) fragment.append(renderCard(agent, bucket));
  }

  threadList.replaceChildren(fragment);
  const label = repoFilter ? `${visible.length} in ${repoFilter}` : `${agents.size} threads`;
  el("thread-total").textContent = label;
  empty.classList.toggle("hidden", agents.size > 0);
}

function renderCard(agent: AgentEvent, bucket: Bucket): HTMLElement {
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

  const metaWrap = document.createElement("span");
  metaWrap.className = "thread-meta-wrap";
  const meta = document.createElement("span");
  meta.className = "thread-meta";
  const waited = relTime(agent.stateSince);
  meta.textContent = waited ? `${agent.state} ${waited}` : agent.state;
  metaWrap.append(meta);

  if (bucket === "needs-you") {
    const done = document.createElement("button");
    done.className = "thread-dismiss";
    done.type = "button";
    done.textContent = "✓";
    done.title = "Mark handled — moves to idle until something new happens";
    done.addEventListener("click", () => dismiss(agent));
    metaWrap.append(done);
  }

  card.append(state, name, metaWrap);

  const mission = agent.mission ?? agent.task;
  if (mission) {
    const missionEl = document.createElement("span");
    missionEl.className = "thread-task";
    missionEl.textContent = mission;
    missionEl.title = mission;
    card.append(missionEl);
  }
  if (agent.task && agent.mission && agent.task !== agent.mission) {
    const followUp = document.createElement("span");
    followUp.className = "thread-followup";
    followUp.textContent = `↳ ${agent.task}`;
    followUp.title = agent.task;
    card.append(followUp);
  }

  const activity = document.createElement("span");
  activity.className = "thread-activity";
  activity.textContent = agent.activity ? `▸ ${agent.activity}` : "▸ waiting for an update";
  activity.title = agent.activity ?? "";
  card.append(activity);

  if (agent.repo || agent.branch || agent.prUrl) {
    const links = document.createElement("span");
    links.className = "thread-links";
    if (agent.repo) {
      const repo = document.createElement("button");
      repo.className = "thread-repo";
      repo.type = "button";
      repo.textContent = agent.repo;
      repo.title = repoFilter === agent.repo ? "Clear filter" : `Show only ${agent.repo}`;
      repo.classList.toggle("active", repoFilter === agent.repo);
      repo.addEventListener("click", () => {
        repoFilter = repoFilter === agent.repo ? null : (agent.repo ?? null);
        if (lastAgents) updateThreadList(lastAgents);
      });
      links.append(repo);
    }
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

  return card;
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
