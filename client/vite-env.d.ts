/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override for the WebSocket bus URL (e.g. ws://host:8787). */
  readonly VITE_BUS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
