import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { agentEventSchema, type AgentEvent } from "../shared/schema.js";

/**
 * Resolve the on-disk snapshot path from DATA_DIR + STATE_FILE. An absolute
 * STATE_FILE wins outright; otherwise it is placed under DATA_DIR (default
 * ./data), which is what the Docker volume mounts. Both are configurable so the
 * same binary works natively and in a container.
 */
export function resolveStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const stateFile = env.STATE_FILE ?? "state.json";
  if (isAbsolute(stateFile)) return stateFile;
  const dataDir = env.DATA_DIR ?? "./data";
  return resolve(join(dataDir, stateFile));
}

/**
 * Whether an agent should be written to the durable snapshot. Mock creatures
 * (all `mock-` prefixed, see collectors/mock.ts) are excluded so the offline demo
 * run of `npm run dev` never pollutes a real production state file — a restart of
 * a real hub should come back with only the agents that actually reported in.
 */
export function isPersistable(agent: AgentEvent): boolean {
  return !agent.agentId.startsWith("mock-");
}

type Snapshot = { version: 1; savedAt: number; agents: AgentEvent[] };

/**
 * Lightweight, dependency-free JSON snapshot store for the bus's latest agent
 * state. Writes are atomic (temp file + rename) and debounced (coalesce bursts of
 * events into one write); loads are tolerant (missing file -> empty, corrupt file
 * -> quarantined and empty so the hub always boots).
 */
export class StateStore {
  readonly path: string;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: AgentEvent[] | null = null;
  private saves = 0;
  private lastError: string | null = null;

  constructor(opts: { path?: string; debounceMs?: number } = {}) {
    this.path = opts.path ?? resolveStatePath();
    this.debounceMs = opts.debounceMs ?? 500;
  }

  /** Read and validate the persisted agents; never throws. */
  load(): AgentEvent[] {
    if (!existsSync(this.path)) return [];
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (err) {
      this.lastError = `load failed: ${String(err)}`;
      console.warn("[store] could not read state file:", err);
      return [];
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      this.quarantine(raw, "invalid JSON");
      return [];
    }

    const list = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data.agents)
        ? data.agents
        : null;
    if (!list) {
      this.quarantine(raw, "unexpected shape");
      return [];
    }

    // Validate each entry independently so one bad record can't drop the rest.
    const agents: AgentEvent[] = [];
    for (const item of list) {
      const parsed = agentEventSchema.safeParse(item);
      if (parsed.success) agents.push(parsed.data);
    }
    return agents;
  }

  /** Queue a persistable subset of `agents` to be written after the debounce. */
  scheduleSave(agents: AgentEvent[]): void {
    this.pending = agents.filter(isPersistable);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    // Don't keep the event loop alive just for a pending snapshot write.
    this.timer.unref?.();
  }

  /** Write any queued snapshot immediately (used on shutdown and in tests). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending === null) return;
    this.writeNow(this.pending);
    this.pending = null;
  }

  status(): { path: string; saves: number; lastError: string | null } {
    return { path: this.path, saves: this.saves, lastError: this.lastError };
  }

  private writeNow(agents: AgentEvent[]): void {
    const snapshot: Snapshot = { version: 1, savedAt: Date.now(), agents };
    // Unique-ish temp name avoids clobbering if two writes ever overlap; rename
    // is atomic on the same filesystem so readers never see a half-written file.
    const tmp = `${this.path}.tmp.${process.pid}`;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(tmp, JSON.stringify(snapshot), "utf8");
      renameSync(tmp, this.path);
      this.saves += 1;
      this.lastError = null;
    } catch (err) {
      this.lastError = `save failed: ${String(err)}`;
      console.warn("[store] could not write state file:", err);
    }
  }

  private quarantine(raw: string, reason: string): void {
    this.lastError = `corrupt state (${reason})`;
    const backup = `${this.path}.corrupt`;
    try {
      writeFileSync(backup, raw, "utf8");
      console.warn(`[store] ${reason} in ${this.path}; quarantined to ${backup}, starting empty`);
    } catch {
      console.warn(`[store] ${reason} in ${this.path}; starting empty`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
