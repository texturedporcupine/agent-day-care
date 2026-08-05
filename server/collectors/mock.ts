import type { Bus } from "../bus.js";
import { TOOLS, type AgentEventPatch, type Tool } from "../../shared/schema.js";

type MockCreature = {
  agentId: string;
  source: AgentEventPatch["source"];
  species: string;
  nickname: string;
  tokens: number;
};

const CREATURES: MockCreature[] = [
  { agentId: "mock-cloud-1", source: "cursor-cloud", species: "sparkmon", nickname: "Volteon", tokens: 0 },
  { agentId: "mock-cli-1", source: "cursor-cli", species: "embermon", nickname: "Cindaquil", tokens: 0 },
  { agentId: "mock-claude-1", source: "claude", species: "aquamon", nickname: "Squirtwo", tokens: 0 },
  { agentId: "mock-chatgtm-1", source: "chatgtm", species: "leafmon", nickname: "Bulbabot", tokens: 0 },
];

const MOCK_REPOS = ["you/demo-app", "you/api-server", "you/docs-site", "you/mobile-app"];
const MOCK_TASKS = [
  "Add dark mode support across the settings screens",
  "Fix the flaky payment webhook integration tests",
  "Refactor the auth middleware and add rate limiting",
  "Write onboarding docs for the new CLI workflow",
];

const ACTIVITIES: Record<Tool, string[]> = {
  read_file: ["reading README.md", "reading src/index.ts", "skimming docs/"],
  run_terminal_cmd: ["running tests", "npm install", "building the app"],
  mcp: ["querying Linear MCP", "asking Slack MCP"],
  web: ["searching the web", "fetching docs"],
  other: ["pondering architecture", "tidying imports"],
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/**
 * Cycles fake creatures through egg -> thinking -> working(tool) -> levelup ->
 * napping with random timing, plus the occasional faint, so the scene exercises
 * every state and tool bucket without credentials.
 */
export function startMockCollector(bus: Bus): void {
  for (const [i, creature] of CREATURES.entries()) {
    publish(bus, creature, {
      state: "egg",
      repo: MOCK_REPOS[i % MOCK_REPOS.length],
      task: MOCK_TASKS[i % MOCK_TASKS.length],
    });
    setTimeout(() => runLifecycle(bus, creature), i * 1500);
  }
  console.log("[mock] collector started with", CREATURES.length, "creatures");
}

function publish(bus: Bus, c: MockCreature, patch: Omit<AgentEventPatch, "agentId">): void {
  bus.publish({
    agentId: c.agentId,
    source: c.source,
    species: c.species,
    nickname: c.nickname,
    ts: Date.now(),
    ...patch,
  });
}

function runLifecycle(bus: Bus, c: MockCreature): void {
  const step = (patch: Omit<AgentEventPatch, "agentId">, delayMs: number, next: () => void) => {
    publish(bus, c, patch);
    setTimeout(next, delayMs);
  };

  const hatch = () =>
    step({ state: "egg", activity: "hatching..." }, rand(2000, 5000), think);

  const think = () =>
    step({ state: "thinking", activity: "planning next move", tool: undefined }, rand(2000, 4000), work);

  let workBursts = 0;
  const work = () => {
    const tool = pick(TOOLS);
    c.tokens += Math.floor(rand(500, 4000));
    workBursts += 1;
    const done = workBursts >= 2 + Math.floor(rand(0, 3));
    step(
      { state: "working", tool, activity: pick(ACTIVITIES[tool]), tokens: c.tokens },
      rand(3000, 6000),
      done ? finish : work,
    );
  };

  const finish = () => {
    workBursts = 0;
    // ~15% of runs end in a faint so the Day Care Lady has a job.
    if (Math.random() < 0.15) {
      step({ state: "fainted", activity: "hit an error!" }, rand(6000, 9000), nap);
    } else {
      step({ state: "levelup", activity: "opened a PR!" }, rand(3000, 4000), nap);
    }
  };

  const nap = () =>
    step({ state: "napping", activity: "zzz...", tool: undefined }, rand(5000, 10000), hatch);

  hatch();
}
