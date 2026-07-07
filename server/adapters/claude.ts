import { normalizeTool } from "../../shared/schema.js";
import type { Adapter } from "./types.js";

/**
 * Claude Code lifecycle hooks -> AgentEvent.
 *
 * Wire it from Claude Code settings (~/.claude/settings.json) with hooks that
 * POST their stdin JSON to this bus, e.g.:
 *   "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command",
 *     "command": "curl -s -X POST http://localhost:8787/hooks/claude -d @- -H 'content-type: application/json'" }] }] }
 * Repeat for SessionStart, PostToolUse, Stop.
 *
 * TODO(claude): normalize the exact hook payloads against your installed
 * Claude Code version — field names below (hook_event_name, session_id,
 * tool_name, cwd) match the documented hook stdin shape, but verify locally
 * and adjust here. This file is the only place that needs to change.
 */
export const claudeAdapter: Adapter = (payload) => {
  const sessionId = str(payload.session_id) ?? "claude-session";
  const eventName = str(payload.hook_event_name) ?? "";
  const toolName = str(payload.tool_name);

  const base = {
    agentId: `claude-${sessionId.slice(0, 8)}`,
    source: "claude" as const,
    ts: Date.now(),
  };

  switch (eventName) {
    case "SessionStart":
      return { ...base, state: "egg", activity: "session started" };
    case "UserPromptSubmit":
      return { ...base, state: "thinking", activity: "reading your prompt" };
    case "PreToolUse":
    case "PostToolUse":
      return {
        ...base,
        state: "working",
        tool: normalizeTool(toolName),
        activity: toolName ? `using ${toolName}` : "working",
      };
    case "Stop":
    case "SubagentStop":
      return { ...base, state: "levelup", activity: "finished a turn!" };
    case "SessionEnd":
      return { ...base, state: "napping", activity: "session ended" };
    default:
      return null;
  }
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
