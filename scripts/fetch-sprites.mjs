#!/usr/bin/env node
/**
 * Downloads official Pokémon minisprites (the B2W2-style menu icons) from the
 * community pokesprite repo into public/sprites/, then writes manifest.json so
 * the client loads them instead of the generated art.
 *
 * The sprites are Nintendo/Game Freak IP: they are fetched to your machine
 * only and the folder is gitignored — never committed to the repo.
 *
 * Usage:
 *   npm run sprites                        # fetch the default species set
 *   npm run sprites -- sparkmon=raichu     # override / add species mappings
 *   npm run sprites -- --style gen7x       # pre-gen8 icon style (closer to B2W2)
 *
 * You can also hand-place PNGs (e.g. sliced B2W2 overworld sheets from
 * spriters-resource.com) into public/sprites/ as creature-<species>.png,
 * egg.png, lady.png or prop-*.png, then re-run this script to rebuild the
 * manifest — existing files are never re-downloaded or overwritten.
 */

import { mkdir, writeFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SPRITES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sprites");
const BASE = "https://raw.githubusercontent.com/msikma/pokesprite/master";

/** species used by the collectors -> pokemon name in pokesprite. */
const DEFAULT_MAPPING = {
  sparkmon: "pikachu",
  embermon: "cyndaquil",
  aquamon: "totodile",
  leafmon: "chikorita",
  default: "eevee",
};

/** Texture keys the client recognizes, besides creature-<species>. */
const EXTRA_KEYS = new Set(["egg", "lady", "prop-book", "prop-keyboard", "prop-mailbox", "prop-bowl"]);

function parseArgs(argv) {
  const mapping = { ...DEFAULT_MAPPING };
  let style = "gen8";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--style") {
      style = argv[++i] ?? style;
    } else if (arg.includes("=")) {
      const [species, pokemon] = arg.split("=");
      if (species && pokemon) mapping[species] = pokemon.toLowerCase();
    }
  }
  return { mapping, style };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(1, 4).toString() !== "PNG") throw new Error("not a PNG");
  await writeFile(dest, buf);
}

async function main() {
  const { mapping, style } = parseArgs(process.argv.slice(2));
  await mkdir(SPRITES_DIR, { recursive: true });

  for (const [species, pokemon] of Object.entries(mapping)) {
    const file = `creature-${species}.png`;
    const dest = join(SPRITES_DIR, file);
    if (await exists(dest)) {
      console.log(`skip     ${file} (already present)`);
      continue;
    }
    const url = `${BASE}/pokemon-${style}/regular/${pokemon}.png`;
    try {
      await download(url, dest);
      console.log(`fetched  ${file} <- ${pokemon} (${style})`);
    } catch (err) {
      console.warn(`failed   ${file} <- ${url}: ${err.message}`);
    }
  }

  // Manifest includes every recognized PNG in the folder, hand-placed or fetched.
  const manifest = {};
  for (const file of (await readdir(SPRITES_DIR)).sort()) {
    if (!file.endsWith(".png")) continue;
    const key = file.replace(/\.png$/, "");
    if (key.startsWith("creature-") || EXTRA_KEYS.has(key)) manifest[key] = file;
  }
  await writeFile(join(SPRITES_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest ${Object.keys(manifest).length} sprites -> public/sprites/manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
