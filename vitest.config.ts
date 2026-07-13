import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors the @shared alias from vite.config.ts so tests can import client-style
// paths, while server/shared modules keep using relative ".js" specifiers.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
