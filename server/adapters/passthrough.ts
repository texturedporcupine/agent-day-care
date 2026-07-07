import { agentEventPatchSchema } from "../../shared/schema.js";
import type { Adapter } from "./types.js";

/**
 * Fallback for any source without a dedicated adapter: the payload must
 * already be an AgentEventPatch. Lets any tool that can send JSON join the
 * day care with zero server code:
 *
 *   curl -X POST http://localhost:8787/hooks/sand \
 *     -H 'content-type: application/json' \
 *     -d '{"agentId":"sand-1","source":"chatgtm","state":"working","activity":"crunching"}'
 */
export const passthroughAdapter: Adapter = (payload) => {
  const parsed = agentEventPatchSchema.safeParse({ ts: Date.now(), ...payload });
  return parsed.success ? parsed.data : null;
};
