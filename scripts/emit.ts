/**
 * Tiny CLI to emit an AgentEventPatch to the canonical /api/events ingest, so
 * any local tool (Sand, a shell script, a cron job) can put a creature in the
 * day care without writing an adapter. Run it via `npm run emit -- ...`.
 *
 * Examples:
 *   npm run emit -- --agent sand-1 --state working --activity "indexing repo" --tool read_file
 *   npm run emit -- --agent sand-1 --state levelup --activity "done!" --tokens 4200
 *   INGEST_TOKEN=secret npm run emit -- --agent sand-1 --nickname Sandy --state egg
 *
 * Auth: sends `Authorization: Bearer $INGEST_TOKEN` when INGEST_TOKEN is set (or
 * --token is passed). With no token the server accepts loopback requests only.
 */
import { loadEnv } from "../server/env.js";
import { STATES, TOOLS, agentEventPatchSchema, type AgentEventPatch } from "../shared/schema.js";

// Pick up INGEST_TOKEN / DAYCARE_URL from a repo-root .env when present.
loadEnv();

type Flags = Record<string, string | undefined>;

const ALIASES: Record<string, string> = { agent: "agentId", id: "agentId", url: "url", tokens: "tokens" };

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    let key: string;
    let value: string | undefined;
    if (eq !== -1) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      } else {
        value = "true"; // bare flag, e.g. --help
      }
    }
    flags[ALIASES[key] ?? key] = value;
  }
  return flags;
}

const HELP = `emit — send an AgentEventPatch to POST /api/events

Usage: npm run emit -- --agent <id> [--state <state>] [options]

Required:
  --agent, --id <id>     agent id (stable per creature)

Common:
  --state <state>        one of: ${STATES.join(", ")}
  --activity <text>      human-readable activity, e.g. "reading README.md"
  --tool <tool>          one of: ${TOOLS.join(", ")}
  --tokens <n>           cumulative token count (fills the food bowl)
  --source <source>      source badge (default: sand)
  --species <key>        sprite key (default: server default)
  --nickname <name>      display name
  --url <url>            deep link opened when the creature is clicked

Connection:
  --base <url>           hub base URL (default: $DAYCARE_URL or http://127.0.0.1:8787)
  --token <token>        ingest token (default: $INGEST_TOKEN)
  --help                 show this help
`;

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help === "true" || !flags.agentId) {
    process.stdout.write(HELP);
    process.exit(flags.agentId ? 0 : 1);
  }

  if (flags.state && !STATES.includes(flags.state as (typeof STATES)[number])) {
    fail(`invalid --state "${flags.state}"; expected one of: ${STATES.join(", ")}`);
  }
  if (flags.tool && !TOOLS.includes(flags.tool as (typeof TOOLS)[number])) {
    fail(`invalid --tool "${flags.tool}"; expected one of: ${TOOLS.join(", ")}`);
  }

  const patch: Record<string, unknown> = { agentId: flags.agentId, ts: Date.now() };
  if (flags.source) patch.source = flags.source;
  if (flags.species) patch.species = flags.species;
  if (flags.nickname) patch.nickname = flags.nickname;
  if (flags.state) patch.state = flags.state;
  if (flags.activity) patch.activity = flags.activity;
  if (flags.tool) patch.tool = flags.tool;
  if (flags.tokens !== undefined) patch.tokens = Number(flags.tokens);
  if (flags.url) patch.url = flags.url;

  const parsed = agentEventPatchSchema.safeParse(patch);
  if (!parsed.success) {
    fail(`invalid patch: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }

  const base = flags.base ?? process.env.DAYCARE_URL ?? "http://127.0.0.1:8787";
  const token = flags.token ?? process.env.INGEST_TOKEN;
  const endpoint = `${base.replace(/\/$/, "")}/api/events`;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify((parsed as { success: true; data: AgentEventPatch }).data),
    });
  } catch (err) {
    fail(`could not reach ${endpoint}: ${String(err)}\nIs the hub running? Try \`npm start\`.`);
    return;
  }

  const text = await res.text();
  if (res.ok) {
    console.log(`✓ ${res.status} ${text}`);
  } else {
    console.error(`✗ ${res.status} ${text}`);
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`emit: ${message}`);
  process.exit(1);
}

void main();
