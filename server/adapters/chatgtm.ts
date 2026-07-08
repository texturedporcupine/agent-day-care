import type { Adapter } from "./types.js";

/**
 * ChatGTM run webhooks -> AgentEvent. Point your ChatGTM run-start /
 * run-finish / run-error webhooks at POST /hooks/chatgtm with a payload like
 *   { "runId": "...", "event": "run.start" | "run.finish" | "run.error", "detail"?: "..." }
 *
 * The `event` string is matched loosely (start / finish|complete / error|fail)
 * so minor naming differences still map correctly, and every field is read
 * defensively — a payload missing `runId` or `event`, or carrying non-string
 * values, yields a safe default or a null (ignored) result rather than throwing.
 */
export const chatgtmAdapter: Adapter = (payload) => {
  const runId = str(payload.runId) ?? "run";
  const event = str(payload.event) ?? "";
  const detail = str(payload.detail);

  const base = {
    agentId: `chatgtm-${runId.slice(0, 8)}`,
    source: "chatgtm" as const,
    ts: Date.now(),
  };

  // Order matters: match error/finish before the broader "start" test.
  if (/error|fail/i.test(event)) return { ...base, state: "fainted", activity: clip(detail ?? "run failed", 40) };
  if (/finish|complete|done/i.test(event)) return { ...base, state: "levelup", activity: clip(detail ?? "run finished!", 40) };
  if (/start|begin/i.test(event)) return { ...base, state: "working", activity: clip(detail ?? "run started", 40) };
  return null;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
