import type { Bus } from "../bus.js";
import { normalizeTool, type AgentEventPatch, type CreatureState } from "../../shared/schema.js";

/**
 * Cursor Cloud Agents API collector (https://cursor.com/docs/cloud-agent/api/endpoints).
 *
 * - Enumerates agents via GET /v1/agents (Basic auth with CURSOR_API_KEY).
 * - Opens the SSE stream for each agent's latest run and maps events:
 *   status RUNNING -> working, thinking -> thinking, tool_call -> working(tool),
 *   result FINISHED -> levelup then napping, ERROR -> fainted.
 * - Reconnects with Last-Event-ID; on 410 stream_expired reads terminal state
 *   from GET /v1/agents/{id}/runs/{runId} instead.
 * - Polls GET /v1/agents/{id}/usage for totalTokens (the food bowl).
 */

const API = "https://api.cursor.com";
const AGENT_POLL_MS = 30_000;
const USAGE_POLL_MS = 60_000;
/** The yard fits 8 pens (2 rows of 4); track the most recently updated agents. */
const DEFAULT_AGENT_LIMIT = 8;

const SPECIES_ROTATION = ["sparkmon", "embermon", "aquamon", "leafmon"];

type CloudRepo = { url?: string; startingRef?: string; prUrl?: string };

type CloudAgent = {
  id: string;
  name?: string;
  /** Agent-level lifecycle: ACTIVE | ARCHIVED. Run-level states come from the stream. */
  status?: string;
  latestRunId?: string;
  url?: string;
  repos?: CloudRepo[];
  updatedAt?: string;
};

type GitInfo = { branches?: { name?: string; branch?: string; prUrl?: string }[] };

export function startCursorCloudCollector(bus: Bus): void {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) return;
  const collector = new CursorCloudCollector(bus, apiKey);
  void collector.start();
}

class CursorCloudCollector {
  private authHeader: string;
  /** agentId -> runId currently being streamed, to avoid duplicate streams. */
  private activeStreams = new Map<string, string>();
  private knownAgents = new Set<string>();
  private speciesIndex = 0;

  constructor(
    private bus: Bus,
    apiKey: string,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  async start(): Promise<void> {
    console.log("[cursor-cloud] collector started");
    await this.pollAgents();
    setInterval(() => void this.pollAgents(), AGENT_POLL_MS);
    setInterval(() => void this.pollUsage(), USAGE_POLL_MS);
  }

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: this.authHeader, ...init.headers },
    });
  }

  private async pollAgents(): Promise<void> {
    try {
      const res = await this.api("/v1/agents?limit=20");
      if (!res.ok) {
        console.warn("[cursor-cloud] list agents failed:", res.status);
        return;
      }
      // The v1 API returns { items, nextCursor }; older docs used { agents }.
      const body = (await res.json()) as { items?: CloudAgent[]; agents?: CloudAgent[] };
      const limit = Number(process.env.CURSOR_AGENT_LIMIT ?? DEFAULT_AGENT_LIMIT);
      const agents = (body.items ?? body.agents ?? [])
        .filter((agent) => agent.status?.toUpperCase() !== "ARCHIVED")
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
        .slice(0, limit);
      // Stagger stream opens so a burst of new agents doesn't trip rate limits.
      agents.forEach((agent, i) => this.trackAgent(agent, i * 800));
    } catch (err) {
      console.warn("[cursor-cloud] list agents error:", err);
    }
  }

  private trackAgent(agent: CloudAgent, streamDelayMs = 0): void {
    const agentId = agent.id;
    this.knownAgents.add(agentId);
    const repo = agent.repos?.[0];
    const repoName = repo?.url?.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "");
    const known = this.bus.getAgent(agentId);
    if (!known) {
      const species = SPECIES_ROTATION[this.speciesIndex++ % SPECIES_ROTATION.length]!;
      this.publish(agentId, {
        source: "cursor-cloud",
        species,
        nickname: agent.name?.slice(0, 40) ?? agentId.slice(0, 10),
        state: "egg",
        url: agent.url ?? `https://cursor.com/agents?id=${agentId}`,
        ...(repoName ? { repo: repoName } : {}),
        ...(repo?.prUrl ? { prUrl: repo.prUrl } : {}),
      });
    } else if (repo?.prUrl && known.prUrl !== repo.prUrl) {
      this.publish(agentId, { prUrl: repo.prUrl });
    }

    const runId = agent.latestRunId;
    if (runId && this.activeStreams.get(agentId) !== runId) {
      this.activeStreams.set(agentId, runId);
      setTimeout(() => void this.streamRun(agentId, runId), streamDelayMs);
    } else if (!runId && agent.status) {
      this.publish(agentId, { state: mapStatus(agent.status) });
    }
  }

  private async streamRun(agentId: string, runId: string, lastEventId?: string): Promise<void> {
    try {
      const res = await this.api(`/v1/agents/${agentId}/runs/${runId}/stream`, {
        headers: {
          Accept: "text/event-stream",
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
      });

      // 410 = stream expired, 409 = run no longer streamable (already finished):
      // both mean "read the terminal state instead".
      if (res.status === 410 || res.status === 409) {
        await this.readTerminalState(agentId, runId);
        return;
      }
      if (res.status === 429) {
        const backoff = 5000 + Math.random() * 10_000;
        setTimeout(() => void this.streamRun(agentId, runId, lastEventId), backoff);
        return;
      }
      if (!res.ok || !res.body) {
        console.warn(`[cursor-cloud] stream ${runId} failed:`, res.status);
        this.activeStreams.delete(agentId);
        return;
      }

      let latestId = lastEventId;
      for await (const event of parseSse(res.body)) {
        if (event.id) latestId = event.id;
        const done = this.handleStreamEvent(agentId, event);
        if (done) {
          this.activeStreams.delete(agentId);
          return;
        }
      }

      // Stream dropped without a terminal event: resume from the last id.
      setTimeout(() => void this.streamRun(agentId, runId, latestId), 2000);
    } catch (err) {
      console.warn(`[cursor-cloud] stream ${runId} error, retrying:`, err);
      setTimeout(() => void this.streamRun(agentId, runId, lastEventId), 5000);
    }
  }

  /** Returns true when the run reached a terminal event. */
  private handleStreamEvent(agentId: string, event: SseEvent): boolean {
    const data = safeJson(event.data);
    switch (event.event) {
      case "status":
        this.publish(agentId, { state: mapStatus(String(data?.status ?? "")) });
        return false;
      case "thinking":
        this.publish(agentId, { state: "thinking", activity: "thinking..." });
        return false;
      case "tool_call": {
        const name = typeof data?.name === "string" ? data.name : undefined;
        this.publish(agentId, {
          state: "working",
          tool: normalizeTool(name),
          activity: name ? `using ${name}` : "working",
        });
        return false;
      }
      case "assistant":
        this.publish(agentId, { state: "working", activity: "writing a reply" });
        return false;
      case "interaction_update": {
        // The latest user message is the agent's current high-level ask.
        if (data?.type === "user-message-appended") {
          const text = (data.userMessage as { text?: string } | undefined)?.text;
          if (text) {
            this.publish(agentId, {
              state: "working",
              task: normalizeWhitespace(text).slice(0, 200),
              activity: "reading new instructions",
            });
          }
        }
        return false;
      }
      case "result": {
        const status = String(data?.status ?? "FINISHED");
        this.finishRun(agentId, status, data?.git);
        return true;
      }
      case "error":
        this.publish(agentId, { state: "fainted", activity: String(data?.message ?? "error") });
        return true;
      default:
        return event.event === "done";
    }
  }

  private finishRun(agentId: string, status: string, git: unknown): void {
    if (/error|fail/i.test(status)) {
      this.publish(agentId, { state: "fainted", activity: "run errored" });
      return;
    }
    const head = (git as GitInfo | undefined)?.branches?.[0];
    const branch = head?.branch ?? head?.name;
    // Stays in levelup ("needs you") until a new run starts or you dismiss it.
    this.publish(agentId, {
      state: "levelup",
      activity: branch ? `pushed ${branch}` : "finished a run!",
      ...(branch ? { branch } : {}),
      ...(head?.prUrl ? { prUrl: head.prUrl } : {}),
    });
  }

  private async readTerminalState(agentId: string, runId: string): Promise<void> {
    this.activeStreams.delete(agentId);
    try {
      const res = await this.api(`/v1/agents/${agentId}/runs/${runId}`);
      if (!res.ok) return;
      const run = (await res.json()) as { status?: string; git?: unknown };
      this.finishRun(agentId, run.status ?? "FINISHED", run.git);
    } catch (err) {
      console.warn("[cursor-cloud] terminal state fetch failed:", err);
    }
  }

  private async pollUsage(): Promise<void> {
    for (const agentId of this.knownCloudAgentIds()) {
      try {
        const res = await this.api(`/v1/agents/${agentId}/usage`);
        if (!res.ok) continue;
        const body = (await res.json()) as { totalUsage?: { totalTokens?: number } };
        const tokens = body.totalUsage?.totalTokens;
        if (typeof tokens === "number") this.publish(agentId, { tokens });
      } catch {
        // usage is cosmetic; skip on failure
      }
    }
  }

  private knownCloudAgentIds(): string[] {
    return [...this.knownAgents];
  }

  private publish(agentId: string, patch: Omit<AgentEventPatch, "agentId">): void {
    this.bus.publish({ agentId, ts: Date.now(), ...patch });
  }
}

function mapStatus(status: string): CreatureState {
  switch (status.toUpperCase()) {
    case "RUNNING":
      return "working";
    case "ACTIVE":
      return "napping";
    case "CREATING":
    case "PENDING":
    case "QUEUED":
      return "egg";
    case "FINISHED":
    case "COMPLETED":
      return "napping";
    case "ERROR":
    case "FAILED":
      return "fainted";
    default:
      return "thinking";
  }
}

type SseEvent = { id?: string; event: string; data: string };

/** Minimal SSE parser over a fetch body stream. */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let current: { id?: string; event?: string; lines: string[] } = { lines: [] };

  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);

      if (line === "") {
        if (current.event || current.lines.length > 0) {
          yield { id: current.id, event: current.event ?? "message", data: current.lines.join("\n") };
        }
        current = { lines: [] };
      } else if (line.startsWith("id:")) {
        current.id = line.slice(3).trim();
      } else if (line.startsWith("event:")) {
        current.event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        current.lines.push(line.slice(5).trimStart());
      }
    }
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
