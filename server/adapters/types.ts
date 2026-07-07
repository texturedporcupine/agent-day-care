import type { AgentEventPatch } from "../../shared/schema.js";

/**
 * An adapter is a pure mapping from one platform's webhook payload to an
 * AgentEventPatch. Adding a new source (sand, the next tool) = one adapter
 * file + a registry entry; transport, validation, and the scene are shared.
 *
 * Return null to ignore a payload (e.g. an event type we don't care about).
 */
export type Adapter = (payload: Record<string, unknown>) => AgentEventPatch | null;
