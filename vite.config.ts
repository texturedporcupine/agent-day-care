import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Pop the dashboard open in the default browser on `npm run dev`.
    // Headless environments (CI, cloud VMs) just log a warning and continue.
    open: true,
  },
});
