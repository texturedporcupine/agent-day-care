import { normalizeTool } from "../../shared/schema.js";
import type { Adapter } from "./types.js";

/**
 * Claude Code lifecycle hooks -> AgentEvent.
 *
 * Wire it from Claude Code settings (~/.claude/settings.json) with hooks that
 * POST their stdin JSON to this bus, e.g.:
 *   "hooks": { "PreToolUse": [{ "hooks": [{ "type": "command",
 *     "command": "curl -s -X POST http://localhost:8787/hooks/claude -d @- -H 'content-type: application/json'" }] }] }
 * Repeat for SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd.
 *
 * Field names follow Claude Code's documented hook stdin shape
 * (https://code.claude.com/docs/en/hooks): every event carries `session_id`,
 * `cwd`, and `hook_event_name`; tool events add `tool_name` / `tool_input`;
 * `UserPromptSubmit` adds `prompt`; `SessionStart` adds a `source` start reason.
 * Every field is read defensively so a partial or future payload can never
 * throw — unrecognized events are ignored (return null).
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
    case "SessionStart": {
      const reason = str(payload.source);
      return { ...base, state: "egg", activity: reason ? `session started (${reason})` : "session started" };
    }
    case "UserPromptSubmit": {
      // Official docs call this `prompt`; some builds emit `user_prompt`.
      const prompt = str(payload.prompt) ?? str(payload.user_prompt);
      return { ...base, state: "thinking", activity: prompt ? `reading: ${clip(prompt, 40)}` : "reading your prompt" };
    }
    case "PreToolUse":
    case "PostToolUse": {
      const target = toolTarget(payload.tool_input);
      const label = toolName ? `using ${toolName}` : "working";
      return {
        ...base,
        state: "working",
        tool: normalizeTool(toolName),
        activity: target ? `${label}: ${clip(target, 32)}` : label,
      };
    }
    case "Stop":
    case "SubagentStop":
      return { ...base, state: "levelup", activity: "finished a turn!" };
    case "SessionEnd":
      return { ...base, state: "napping", activity: "session ended" };
    default:
      // Notification, PreCompact, permission events, and anything we don't model.
      return null;
  }
};

/** Pull a human-readable target out of a tool_input object (file path, command, url, ...). */
function toolTarget(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  return (
    str(input.file_path) ??
    str(input.path) ??
    str(input.command) ??
    str(input.url) ??
    str(input.pattern) ??
    str(input.query) ??
    undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
