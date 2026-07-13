# Agent Day Care

A Pokemon-day-care-style live view of your AI agents. Each agent is a pixel-art
creature in its own fenced pen; its real live state drives what the creature
does — eggs wobble while agents boot, working creatures walk to the play
equipment matching their current tool, finished runs pop a "PR!" ribbon, and
the Day Care Lady rushes over when something faints.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. With no configuration, the **mock collector** runs
and four creatures cycle through every state — the scene works fully offline.
If the bus is unreachable or no agents have arrived yet, the yard shows a
connection indicator (top-right) and a centered "no agents yet" message instead
of sitting silent.

`npm run dev` runs two processes: Vite serves the client on `5173`, and the bus
runs separately on `8787` (the client connects to it directly). Great for
hot-reload; for an always-on dashboard use the local production hub below.

# Local production hub

The hub is a single always-on Node service that serves the dashboard, hosts the
WebSocket bus, runs the collectors, exposes the authenticated `/api/events`
ingest and `/healthz`, and persists agent state across restarts — all on one
port, bound to `127.0.0.1` by default.

**Prerequisites:** Node 20+ (native run) and/or Docker + Docker Compose (container
run). No external services are required; with nothing configured the mock
collector animates the scene offline.

## Environment matrix

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` (`BUS_PORT`) | `8787` | Port for the one-process hub. `PORT` wins. |
| `HOST` | `127.0.0.1` | Bind address. Loopback keeps the dashboard local; the Docker image sets `0.0.0.0`. |
| `INGEST_TOKEN` | _(unset)_ | Bearer token for `POST /api/events`. Unset ⇒ loopback-only + boot warning. |
| `CURSOR_API_KEY` | _(unset)_ | Enables the Cursor Cloud collector. |
| `CURSOR_CLI` / `CURSOR_CLI_PROMPT` | _(unset)_ | Enable + prompt the Cursor CLI collector. |
| `WEBHOOKS` | _(unset)_ | Enable `POST /hooks/:sourceId` (Claude, ChatGTM, generic). |
| `WEBHOOK_SECRET` | _(unset)_ | When set, webhooks must send `X-Daycare-Secret`. |
| `MOCK` | auto | Force the mock on/off. Default on unless a real source is configured. |
| `PERSIST` | `1` | Set `0` to disable the state snapshot. |
| `DATA_DIR` / `STATE_FILE` | `./data` / `state.json` | Where the snapshot lives (Docker volume mount point). |
| `DAYCARE_URL` | `http://127.0.0.1:8787` | Base URL used by `npm run emit`. |

Copy `.env.example` to `.env` and set only what you need. Never commit real
secrets.

## Native run

```bash
npm install
npm run build      # typecheck + bundle the client into dist/
npm start          # serve dist/ AND run the bus + collectors on one port
```

Open **http://localhost:8787** — that's it. One Node process serves the built
client, hosts the WebSocket bus, and runs the collectors, so client and bus are
same-origin (no Vite dev server, no second port). The page derives its bus URL
from its own origin, so whatever host/port you serve on just works, including
behind `https`/`wss`.

- **Port** — `PORT=9000 npm start` then open http://localhost:9000. Rebuilding
  is not required to change the port.
- **Collectors** — the same env vars apply; see the matrix above. With
  `WEBHOOKS=1`, `POST /hooks/:sourceId` is served on this same port.
- **Pens** — `daycare.config.json` is loaded on boot as usual.

If you run `npm start` without a `dist/`, it prints a hint and still runs the
bus (so dev clients can connect); build first to serve the dashboard here.

> Pointing a Vite dev client at a remote bus? Set `VITE_BUS_URL` (e.g.
> `VITE_BUS_URL=ws://some-host:8787`) to override the derived URL.

## Docker Compose run

```bash
docker compose up --build -d      # build + start in the background
curl -s http://127.0.0.1:8787/healthz
docker compose logs -f            # follow logs
docker compose down               # stop (named volume `daycare-data` persists state)
```

The multi-stage image builds the client and an esbuild-bundled server, then runs
a small non-root `node` process — no `node_modules`, no build tools in the final
image. `docker-compose.yml`:

- binds **`127.0.0.1:8787`** on the host (dashboard stays local),
- sets `HOST=0.0.0.0` **inside** the container so the process is reachable there,
- mounts the named volume `daycare-data` at `/app/data` (`DATA_DIR`),
- restarts `unless-stopped`, with a `/healthz` healthcheck.

> **Ingest in Docker:** requests from your host reach the container from the
> container gateway, which is **not** loopback inside the container. So to use
> `POST /api/events` in Docker you **must** set `INGEST_TOKEN` (uncomment it in
> `docker-compose.yml`) and send `Authorization: Bearer <token>`. Webhooks use
> `WEBHOOK_SECRET` instead.

## Persistence

The bus's latest per-agent state is written to a single JSON snapshot
(`$DATA_DIR/$STATE_FILE`, default `./data/state.json`). Writes are **atomic**
(temp file + rename) and **debounced** (a burst of events coalesces into one
write); the final state is flushed on `SIGINT`/`SIGTERM`. On boot the file is
loaded **tolerantly**: a missing file starts empty, and a corrupt or wrong-shape
file is quarantined to `state.json.corrupt` so the hub always starts. Individually
invalid records are dropped without discarding the rest, and a live collector's
event always wins over stale disk state for the same agent.

**Mock agents are never persisted.** All mock creatures use a `mock-` id prefix
and are filtered out of the snapshot, so running the offline demo (`npm run dev`
or `MOCK=1`) can never pollute a real hub's saved state.

## Health / operations

`GET /healthz` returns JSON for uptime checks and dashboards (no secrets):

```bash
curl -s http://127.0.0.1:8787/healthz
# {"status":"ok","uptimeSeconds":42,"browsers":1,"agents":3,
#  "collectors":["ingest","webhooks"],
#  "persistence":{"enabled":true,"path":"/app/data/state.json","saves":7,"lastError":null}}
```

## Universal authenticated ingest — `POST /api/events`

This is the canonical way for **any** local agent to join the day care without
writing an adapter: POST a partial [`AgentEventPatch`](shared/schema.ts) and the
bus merges it into that agent's state. It is always mounted (native and Docker).

- **Auth** — when `INGEST_TOKEN` is set, send `Authorization: Bearer <token>`
  (compared timing-safely). When it is **unset**, only loopback callers are
  accepted and the server warns loudly at boot; non-loopback callers get `401`.
- **Validation** — `POST` only, `Content-Type: application/json`, JSON object
  shape, zod validation, and a 64 KB body cap. Every failure is a small JSON
  `{ "error": ... }` with the right status (`401`/`405`/`413`/`415`/`400`).

```bash
# Loopback, no token configured:
curl -X POST http://127.0.0.1:8787/api/events \
  -H 'content-type: application/json' \
  -d '{"agentId":"sand-1","source":"sand","nickname":"Sandy","state":"working","activity":"indexing repo","tool":"read_file","tokens":1200}'

# With a token (required for remote / Docker):
curl -X POST http://127.0.0.1:8787/api/events \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_TOKEN' \
  -d '{"agentId":"sand-1","state":"levelup","activity":"opened a PR!"}'
```

### `npm run emit` — the friendly CLI emitter

Same endpoint, no curl ceremony — great for Sand and other local tools to
integrate in one line before ever thinking about an adapter:

```bash
npm run emit -- --agent sand-1 --state working --activity "indexing repo" --tool read_file --tokens 1200
npm run emit -- --agent sand-1 --state levelup --activity "opened a PR!"
INGEST_TOKEN=YOUR_TOKEN npm run emit -- --agent sand-1 --nickname Sandy --state egg
npm run emit -- --help
```

It reads `DAYCARE_URL` (default `http://127.0.0.1:8787`) and `INGEST_TOKEN` from
the environment (or `--base` / `--token`). States: `egg`, `thinking`, `working`,
`napping`, `levelup`, `fainted`. Tools: `read_file`, `run_terminal_cmd`, `mcp`,
`web`, `other`.

## Per-platform integration

| Platform | How it connects | Config |
| --- | --- | --- |
| **Cursor Cloud** | `cursor-cloud` collector polls the Cloud Agents API + SSE stream | `CURSOR_API_KEY` |
| **Cursor CLI** | `cursor-cli` collector spawns `agent --print --output-format stream-json` | `CURSOR_CLI=1` (`CURSOR_CLI_PROMPT`) |
| **Claude Code** | `POST /hooks/claude` from Claude Code lifecycle hooks | `WEBHOOKS=1` |
| **ChatGTM** | `POST /hooks/chatgtm` from run-start/finish/error webhooks | `WEBHOOKS=1` |
| **Sand** | `POST /api/events` (or `npm run emit`) — no adapter needed | `INGEST_TOKEN` (remote/Docker) |
| **Any future tool** | `POST /api/events` for the canonical contract, or `POST /hooks/<id>` (passthrough) | `INGEST_TOKEN` / `WEBHOOKS=1` |

Two ways in, by preference:

1. **`/api/events`** — the authenticated canonical contract. Preferred for local
   tools you control (Sand, scripts, cron). One token, one payload shape.
2. **`/hooks/:sourceId`** — the webhook collector for platforms that emit their
   own event shapes; an adapter maps them (`claude`, `chatgtm`), and unknown ids
   fall back to a passthrough that accepts `AgentEventPatch`-shaped JSON.

## Security & exposing webhooks

The dashboard, bus, and ingest are **local-only by default** (`HOST=127.0.0.1`;
Docker binds the host port to loopback). Keep it that way unless you have a
reason not to.

Some platforms (e.g. ChatGTM) deliver webhooks from the cloud and need a
publicly reachable URL. Do **not** expose the whole UI. Instead, front **only**
the webhook path with a narrowly scoped tunnel:

- **Cloudflare Tunnel** / **Tailscale Funnel** / **ngrok** pointed at
  `http://127.0.0.1:8787` with the public route restricted to `/hooks/...`.
- Always set `WEBHOOK_SECRET` (webhooks) and `INGEST_TOKEN` (`/api/events`) when
  anything beyond loopback can reach the hub.

## Not supported (by design)

- **No silent tracking of consumer chat apps.** There is no general, global event
  feed for ordinary ChatGPT/Claude/etc. web or desktop conversations, so the hub
  does not pretend to show "every chat tab". Agents appear only when a supported
  collector or an explicit `/api/events` / `/hooks` post reports them.
- **No UI scraping or private/undocumented API hacks.** Integrations use official
  APIs, documented webhooks/hooks, or the explicit local emitter — nothing else.

## Tests and CI

```bash
npm test          # run the unit suite once (vitest)
npm run test:watch  # watch mode
npm run typecheck # tsc --noEmit
npm run build     # typecheck + production bundle
```

Tests cover the pure, easy-to-break-silently logic: `normalizeTool`'s tool
buckets, the bus merge/validation (valid patches merge, invalid ones are dropped
without corrupting state, pens seed eggs, defaults fill in, hydrate/onChange),
each adapter's payload mapping, the webhook collector's secret/size/JSON guards,
the `/api/events` ingest auth + validation (token, loopback, content-type, size,
zod), the state store (reload, corrupt-file quarantine, debounce/atomic write,
mock exclusion), the health payload, and the static handler's path ->
content-type map and directory-traversal guard. The
[CI workflow](.github/workflows/ci.yml) runs `typecheck`, `test`, and `build` on
every push and pull request (Node 20).

## How state maps to behavior

| Agent state | Creature behavior |
| --- | --- |
| `egg` | wobbling egg (agent creating / just launched) |
| `thinking` | sits with an animated `...` bubble |
| `working` | walks to the equipment for its tool: `read_file` = book, `run_terminal_cmd` = keyboard block, `mcp`/`web` = mailbox, anything else = paces happily |
| `napping` | sleeps with Zzz (idle) |
| `levelup` | jumps with sparkles and a "PR!" ribbon (finished) |
| `fainted` | swirl eyes + red flash (error); the Day Care Lady walks over |

Rising `tokens` fill the food bowl and grow the happiness hearts. Clicking a
creature opens its session `url`. The top bar shows working / napping / fainted
counts and total tokens.

## Architecture

Everything conforms to one contract: `AgentEvent` in
[shared/schema.ts](shared/schema.ts), validated with zod at the bus boundary so
a misbehaving source can never break the scene.

```
transports (SSE / NDJSON / HTTP / mock)
        -> adapters (pure payload -> AgentEventPatch functions)
        -> zod validation
        -> server/bus.ts (state store, WebSocket diffs)
        -> client FSM + STATE_BEHAVIOR table (client/behavior.ts)
        -> Phaser scene
```

Adding a new source is one small file:

- If it can POST JSON, you may need **zero code** — see the webhook collector.
- Otherwise, add an adapter in `server/adapters/` and one registry line in
  [server/adapters/index.ts](server/adapters/index.ts).

## Collectors and env vars

Copy `.env.example` to `.env`. Everything is off by default except the mock
(which auto-disables once any real source is configured; force with `MOCK=1`/`MOCK=0`).

### cursor-cloud — `CURSOR_API_KEY`

Uses the [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints):
enumerates agents via `GET /v1/agents`, opens the SSE stream for each agent's
latest run, resumes with `Last-Event-ID`, falls back to `GET .../runs/{runId}`
on `410 stream_expired`, and polls `/usage` for `totalTokens` (the food bowl).
Create a key at Cursor Dashboard -> API Keys.

### cursor-cli — `CURSOR_CLI=1`

Spawns `agent --print --output-format stream-json --stream-partial-output` and
maps the NDJSON stream (`system/init` -> egg, `tool_call` -> working with the
tool's equipment, `result` -> levelup). Set the prompt with `CURSOR_CLI_PROMPT`.

### Webhooks (claude, chatgtm, anything) — `WEBHOOKS=1`

One endpoint captures everything: `POST /hooks/:sourceId` with a JSON body. The
collector only accepts `POST`, rejects bodies over 64 KB (`413`), and returns
`400` for malformed / non-object JSON — a bad request can never crash the bus.
When `WEBHOOK_SECRET` is set, requests **must** send it as the `X-Daycare-Secret`
header or they are rejected with `401`.

- **`/hooks/claude`** — point Claude Code lifecycle hooks at it. In
  `~/.claude/settings.json`, add hooks for `SessionStart`, `PreToolUse`,
  `PostToolUse`, and `Stop` that pipe stdin to the bus:

  ```json
  {
    "hooks": {
      "PreToolUse": [{ "hooks": [{ "type": "command",
        "command": "curl -s -X POST http://localhost:8787/hooks/claude -H 'content-type: application/json' -d @-" }] }]
    }
  }
  ```

  The field mapping lives in [server/adapters/claude.ts](server/adapters/claude.ts).

- **`/hooks/chatgtm`** — point run-start / run-finish webhooks at it; mapping in
  [server/adapters/chatgtm.ts](server/adapters/chatgtm.ts).

- **`/hooks/<anything-else>`** (your next tool) — the passthrough adapter
  accepts payloads already shaped like `AgentEvent`:

  ```bash
  curl -X POST http://localhost:8787/hooks/sand \
    -H 'content-type: application/json' \
    -d '{"agentId":"sand-1","source":"sand","species":"sparkmon","nickname":"Sandy","state":"working","activity":"crunching"}'
  ```

  For tools you control (Sand, scripts), prefer the authenticated
  [`POST /api/events`](#universal-authenticated-ingest--post-apievents) or
  `npm run emit` instead — same contract, with a token and clearer errors.

## Registering pens by hand

Copy `daycare.config.example.json` to `daycare.config.json` (gitignored — it
holds deep links to your real sessions) and add one card per agent:

```json
[
  { "agentId": "cursor-cloud-1", "source": "cursor-cloud", "species": "sparkmon", "nickname": "Volteon", "url": "https://cursor.com/agents?id=bc-..." }
]
```

Registered pens render as eggs on boot and come alive when their collector
publishes events. Agents that show up without a pen get one automatically.

## Art

All sprites are original pixel art generated at boot from pixel-string
templates in [client/textures.ts](client/textures.ts) — no binary assets, no
copyrighted creatures. To swap in real sprite sheets (e.g. Kenney packs), load
images under the same texture keys (`creature-<species>`, `egg`, `lady`,
`prop-*`).
