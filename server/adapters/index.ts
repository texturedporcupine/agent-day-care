import type { Adapter } from "./types.js";
import { claudeAdapter } from "./claude.js";
import { chatgtmAdapter } from "./chatgtm.js";
import { passthroughAdapter } from "./passthrough.js";

/** POST /hooks/:sourceId picks the adapter here; unknown ids use passthrough. */
const REGISTRY: Record<string, Adapter> = {
  claude: claudeAdapter,
  chatgtm: chatgtmAdapter,
};

export function adapterFor(sourceId: string): Adapter {
  return REGISTRY[sourceId] ?? passthroughAdapter;
}
