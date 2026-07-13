import { describe, it, expect } from "vitest";
import { claudeAdapter } from "../server/adapters/claude.js";
import { chatgtmAdapter } from "../server/adapters/chatgtm.js";
import { passthroughAdapter } from "../server/adapters/passthrough.js";
import { adapterFor } from "../server/adapters/index.js";

describe("claudeAdapter", () => {
  it("maps SessionStart to an egg", () => {
    const patch = claudeAdapter({ hook_event_name: "SessionStart", session_id: "abc12345xyz" });
    expect(patch).toMatchObject({
      agentId: "claude-abc12345",
      source: "claude",
      state: "egg",
      activity: "session started",
    });
    expect(typeof patch?.ts).toBe("number");
  });

  it("includes the SessionStart source reason when present", () => {
    const patch = claudeAdapter({ hook_event_name: "SessionStart", session_id: "s", source: "resume" });
    expect(patch).toMatchObject({ state: "egg", activity: "session started (resume)" });
  });

  it("maps UserPromptSubmit to thinking with a prompt snippet", () => {
    const patch = claudeAdapter({ hook_event_name: "UserPromptSubmit", session_id: "s", prompt: "fix the flaky test" });
    expect(patch).toMatchObject({ state: "thinking", activity: "reading: fix the flaky test" });
  });

  it("maps PreToolUse to working with the normalized tool and target", () => {
    const patch = claudeAdapter({
      hook_event_name: "PreToolUse",
      session_id: "s",
      tool_name: "Read",
      tool_input: { file_path: "/repo/README.md" },
    });
    expect(patch).toMatchObject({
      state: "working",
      tool: "read_file",
      activity: "using Read: /repo/README.md",
    });
  });

  it("maps PostToolUse for Bash to run_terminal_cmd with the command", () => {
    const patch = claudeAdapter({
      hook_event_name: "PostToolUse",
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    expect(patch).toMatchObject({ state: "working", tool: "run_terminal_cmd", activity: "using Bash: npm test" });
  });

  it("maps Stop and SubagentStop to levelup", () => {
    expect(claudeAdapter({ hook_event_name: "Stop", session_id: "s" })).toMatchObject({ state: "levelup" });
    expect(claudeAdapter({ hook_event_name: "SubagentStop", session_id: "s" })).toMatchObject({ state: "levelup" });
  });

  it("maps SessionEnd to napping", () => {
    expect(claudeAdapter({ hook_event_name: "SessionEnd", session_id: "s" })).toMatchObject({ state: "napping" });
  });

  it("ignores unmodeled events (Notification, PreCompact, unknown)", () => {
    expect(claudeAdapter({ hook_event_name: "Notification", session_id: "s" })).toBeNull();
    expect(claudeAdapter({ hook_event_name: "PreCompact", session_id: "s" })).toBeNull();
    expect(claudeAdapter({ session_id: "s" })).toBeNull();
  });

  it("is defensive against non-string / missing fields", () => {
    // tool_name is not a string -> no tool, generic activity, no throw.
    const patch = claudeAdapter({ hook_event_name: "PreToolUse", tool_name: 123, tool_input: 5 });
    expect(patch).toMatchObject({ state: "working", activity: "working" });
    expect(patch?.tool).toBeUndefined();
    expect(patch?.agentId).toMatch(/^claude-/);
  });
});

describe("chatgtmAdapter", () => {
  it("maps run.start to working", () => {
    const patch = chatgtmAdapter({ runId: "run-9999xxxx", event: "run.start" });
    expect(patch).toMatchObject({ agentId: "chatgtm-run-9999", source: "chatgtm", state: "working", activity: "run started" });
  });

  it("maps run.finish to levelup and uses detail when given", () => {
    const patch = chatgtmAdapter({ runId: "r", event: "run.finish", detail: "merged PR #42" });
    expect(patch).toMatchObject({ state: "levelup", activity: "merged PR #42" });
  });

  it("maps run.error to fainted", () => {
    const patch = chatgtmAdapter({ runId: "r", event: "run.error", detail: "boom" });
    expect(patch).toMatchObject({ state: "fainted", activity: "boom" });
  });

  it("matches error/finish before start (order-independent event strings)", () => {
    // An event that contains both words should not be misclassified as a start.
    expect(chatgtmAdapter({ runId: "r", event: "start.failed" })).toMatchObject({ state: "fainted" });
  });

  it("defaults the runId and ignores unknown events", () => {
    expect(chatgtmAdapter({ event: "run.start" })?.agentId).toBe("chatgtm-run");
    expect(chatgtmAdapter({ runId: "r", event: "run.pinged" })).toBeNull();
    expect(chatgtmAdapter({ runId: "r", event: 123 })).toBeNull();
    expect(chatgtmAdapter({})).toBeNull();
  });
});

describe("passthroughAdapter", () => {
  it("accepts an AgentEventPatch-shaped payload and defaults ts", () => {
    const patch = passthroughAdapter({
      agentId: "sand-1",
      source: "chatgtm",
      species: "leafmon",
      nickname: "Sandy",
      state: "working",
      activity: "crunching",
    });
    expect(patch).toMatchObject({ agentId: "sand-1", source: "chatgtm", state: "working" });
    expect(typeof patch?.ts).toBe("number");
  });

  it("accepts a minimal patch (only agentId is required)", () => {
    expect(passthroughAdapter({ agentId: "x" })).toMatchObject({ agentId: "x" });
  });

  it("rejects payloads that are not valid patches", () => {
    expect(passthroughAdapter({ state: "working" })).toBeNull(); // no agentId
    expect(passthroughAdapter({ agentId: "x", state: "flying" })).toBeNull(); // bad enum
    expect(passthroughAdapter({ agentId: "x", url: "not-a-url" })).toBeNull();
  });
});

describe("adapterFor", () => {
  it("routes known source ids to their adapter and unknown ids to passthrough", () => {
    expect(adapterFor("claude")).toBe(claudeAdapter);
    expect(adapterFor("chatgtm")).toBe(chatgtmAdapter);
    expect(adapterFor("sand")).toBe(passthroughAdapter);
    expect(adapterFor("anything-else")).toBe(passthroughAdapter);
  });
});
