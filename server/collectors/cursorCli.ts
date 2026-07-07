import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Bus } from "../bus.js";
import { normalizeTool, type AgentEventPatch } from "../../shared/schema.js";

/**
 * Cursor CLI collector: spawns
 *   agent --print --output-format stream-json --stream-partial-output <prompt>
 * and maps NDJSON stdout lines to AgentEvents:
 *   system/init -> egg, assistant -> working, tool_call started -> working(tool),
 *   result -> levelup then napping.
 *
 * Enable with CURSOR_CLI=1; set the prompt via CURSOR_CLI_PROMPT.
 */
export function startCursorCliCollector(bus: Bus): void {
  const prompt = process.env.CURSOR_CLI_PROMPT ?? "Give a one-paragraph summary of this repository";
  const agentId = "cursor-cli-1";

  const publish = (patch: Omit<AgentEventPatch, "agentId">) =>
    bus.publish({
      agentId,
      source: "cursor-cli",
      species: "embermon",
      nickname: "CLI Agent",
      ts: Date.now(),
      ...patch,
    });

  publish({ state: "egg", activity: "launching agent..." });

  const child = spawn(
    "agent",
    ["--print", "--output-format", "stream-json", "--stream-partial-output", prompt],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  console.log("[cursor-cli] spawned agent pid", child.pid);

  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(event.type ?? "");
    switch (type) {
      case "system":
        if (event.subtype === "init") publish({ state: "egg", activity: "initialized" });
        break;
      case "assistant":
        publish({ state: "working", activity: "writing a reply" });
        break;
      case "tool_call": {
        const call = event.tool_call as { name?: string; status?: string } | undefined;
        const name = call?.name ?? (typeof event.name === "string" ? event.name : undefined);
        publish({
          state: "working",
          tool: normalizeTool(name),
          activity: name ? `using ${name}` : "working",
        });
        break;
      }
      case "result":
        publish({ state: "levelup", activity: "finished!" });
        setTimeout(() => {
          if (bus.getAgent(agentId)?.state === "levelup") {
            publish({ state: "napping", activity: "resting" });
          }
        }, 5000);
        break;
      default:
        break;
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    console.warn("[cursor-cli]", chunk.toString().trim());
  });
  child.on("error", (err) => {
    console.warn("[cursor-cli] failed to spawn `agent`:", err.message);
    publish({ state: "fainted", activity: "agent CLI not found" });
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      publish({ state: "fainted", activity: `exited with code ${code}` });
    }
  });
}
