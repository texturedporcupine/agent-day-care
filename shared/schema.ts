import { z } from "zod";

// Order is append-only for backwards compatibility: existing values keep their
// meaning and new platforms are added at the end. `sand` covers the Sand local
// tool, which integrates through the universal /api/events emitter (no adapter).
export const SOURCES = ["cursor-cloud", "cursor-cli", "claude", "chatgtm", "sand"] as const;
export type Source = (typeof SOURCES)[number];

export const STATES = ["egg", "napping", "thinking", "working", "levelup", "fainted"] as const;
export type CreatureState = (typeof STATES)[number];

/**
 * Canonical tool buckets. Collectors/adapters map platform-specific tool names
 * into one of these; anything unrecognized becomes "other" (creature paces happily).
 */
export const TOOLS = ["read_file", "run_terminal_cmd", "mcp", "web", "other"] as const;
export type Tool = (typeof TOOLS)[number];

export const agentEventSchema = z.object({
  /** Stable per creature. */
  agentId: z.string().min(1),
  source: z.enum(SOURCES),
  /** Sprite key, e.g. "sparkmon". Unknown keys fall back to a default sprite. */
  species: z.string().min(1),
  nickname: z.string().min(1),
  state: z.enum(STATES),
  /** Human-readable, e.g. "reading README.md". */
  activity: z.string().optional(),
  tool: z.enum(TOOLS).optional(),
  /** Cumulative tokens; fills the food bowl / happiness meter. */
  tokens: z.number().nonnegative().optional(),
  /** Deep link to the real session; clicking the creature opens it. */
  url: z.string().url().optional(),
  ts: z.number(),
});

export type AgentEvent = z.infer<typeof agentEventSchema>;

/** A partial update; the bus merges it into the last known state of that agent. */
export const agentEventPatchSchema = agentEventSchema.partial().required({ agentId: true });
export type AgentEventPatch = z.infer<typeof agentEventPatchSchema>;

/** Pen registration card from daycare.config.json. */
export const penConfigSchema = z.object({
  agentId: z.string().min(1),
  source: z.enum(SOURCES),
  species: z.string().min(1),
  nickname: z.string().min(1),
  url: z.string().url().optional(),
});
export type PenConfig = z.infer<typeof penConfigSchema>;

/** Messages the bus pushes to browsers over WebSocket. */
export type BusMessage =
  | { type: "snapshot"; agents: AgentEvent[] }
  | { type: "diff"; agent: AgentEvent };

/** Map a raw platform tool name onto a canonical Tool bucket. */
export function normalizeTool(raw: string | undefined): Tool | undefined {
  if (!raw) return undefined;
  const name = raw.toLowerCase();
  if (/(read|open|cat|glob|grep|search)[_-]?file|^read$|codebase/.test(name)) return "read_file";
  if (/terminal|shell|bash|cmd|exec/.test(name)) return "run_terminal_cmd";
  if (/^mcp|mcp[_-]/.test(name)) return "mcp";
  if (/web|fetch|browser|http/.test(name)) return "web";
  return "other";
}
