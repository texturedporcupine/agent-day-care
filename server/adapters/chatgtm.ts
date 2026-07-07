import type { Adapter } from "./types.js";

/**
 * ChatGTM run webhooks -> AgentEvent. Adapter stub: point your ChatGTM
 * run-start / run-finish webhooks at POST /hooks/chatgtm with a payload like
 *   { "runId": "...", "event": "run.start" | "run.finish" | "run.error", "detail"?: "..." }
 * and adjust the field mapping here when the real payload shape is known.
 */
export const chatgtmAdapter: Adapter = (payload) => {
  const runId = typeof payload.runId === "string" ? payload.runId : "run";
  const event = typeof payload.event === "string" ? payload.event : "";
  const detail = typeof payload.detail === "string" ? payload.detail : undefined;

  const base = {
    agentId: `chatgtm-${runId.slice(0, 8)}`,
    source: "chatgtm" as const,
    ts: Date.now(),
  };

  if (/start/i.test(event)) return { ...base, state: "working", activity: detail ?? "run started" };
  if (/finish|complete/i.test(event)) return { ...base, state: "levelup", activity: detail ?? "run finished!" };
  if (/error|fail/i.test(event)) return { ...base, state: "fainted", activity: detail ?? "run failed" };
  return null;
};
