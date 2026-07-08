import type { AgentEvent, BusMessage } from "@shared/schema";

/** Never connected yet / handshaking, live, or dropped and retrying. */
export type ConnectionState = "connecting" | "connected" | "disconnected";

export type NetCallbacks = {
  onAgent: (agent: AgentEvent) => void;
  onConnectionChange: (state: ConnectionState) => void;
};

/**
 * Where the WebSocket bus lives, resolved per environment:
 *  - `VITE_BUS_URL` wins if set (point a dev client at a remote bus).
 *  - Vite dev (port 5173) has the bus running separately on 8787.
 *  - Production serves client + bus from one origin, so match the page: same
 *    host and port, ws:// or wss:// following the page protocol.
 */
function resolveBusUrl(): string {
  const override = import.meta.env.VITE_BUS_URL;
  if (override) return override;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  if (import.meta.env.DEV) return `${proto}//${location.hostname}:8787`;
  return `${proto}//${location.host}`;
}

const BUS_URL = resolveBusUrl();

/** Connect to the bus with auto-reconnect; snapshot replays as individual diffs. */
export function connectBus(callbacks: NetCallbacks): void {
  let retryMs = 1000;

  const open = () => {
    callbacks.onConnectionChange("connecting");
    const socket = new WebSocket(BUS_URL);

    socket.onopen = () => {
      retryMs = 1000;
      callbacks.onConnectionChange("connected");
    };

    socket.onmessage = (raw) => {
      const message = JSON.parse(raw.data as string) as BusMessage;
      switch (message.type) {
        case "snapshot":
          for (const agent of message.agents) callbacks.onAgent(agent);
          break;
        case "diff":
          callbacks.onAgent(message.agent);
          break;
        default: {
          const _exhaustive: never = message;
          void _exhaustive;
        }
      }
    };

    socket.onclose = () => {
      callbacks.onConnectionChange("disconnected");
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
  };

  open();
}
