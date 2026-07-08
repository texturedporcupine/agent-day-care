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

## Tests and CI

```bash
npm test          # run the unit suite once (vitest)
npm run test:watch  # watch mode
npm run typecheck # tsc --noEmit
npm run build     # typecheck + production bundle
```

Tests cover the pure, easy-to-break-silently logic: `normalizeTool`'s tool
buckets, the bus merge/validation (valid patches merge, invalid ones are dropped
without corrupting state, pens seed eggs, defaults fill in), each adapter's
payload mapping, and the webhook collector's secret/size/JSON guards. The
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

- **`/hooks/<anything-else>`** (sand, your next tool) — the passthrough adapter
  accepts payloads already shaped like `AgentEvent`:

  ```bash
  curl -X POST http://localhost:8787/hooks/sand \
    -H 'content-type: application/json' \
    -d '{"agentId":"sand-1","source":"chatgtm","species":"leafmon","nickname":"Sandy","state":"working","activity":"crunching"}'
  ```

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
