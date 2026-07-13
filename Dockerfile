# --- Build stage: install everything and produce the client bundle (dist/) and
# a single self-contained server bundle (dist-server/main.mjs) via esbuild.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm run build:server

# --- Runtime stage: just Node + the two bundles. No node_modules, no tsx, no
# build tools — the server bundle has its deps inlined, so the image stays small
# and runs as a plain `node` process under a non-root user.
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/data

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

# Persistent state lives here; owned by the non-root `node` user so a named
# volume inherits writable ownership on first mount.
RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]

EXPOSE 8787

# Container-local health probe (busybox wget ships in alpine).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 || exit 1

CMD ["node", "dist-server/main.mjs"]
