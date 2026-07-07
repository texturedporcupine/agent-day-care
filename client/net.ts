import type { AgentEvent, BusMessage } from "@shared/schema";

export type NetCallbacks = {
  onAgent: (agent: AgentEvent) => void;
  onConnectionChange: (connected: boolean) => void;
};

const BUS_URL = `ws://${location.hostname}:8787`;

/** Connect to the bus with auto-reconnect; snapshot replays as individual diffs. */
export function connectBus(callbacks: NetCallbacks): void {
  let retryMs = 1000;

  const open = () => {
    const socket = new WebSocket(BUS_URL);

    socket.onopen = () => {
      retryMs = 1000;
      callbacks.onConnectionChange(true);
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
      callbacks.onConnectionChange(false);
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
  };

  open();
}
