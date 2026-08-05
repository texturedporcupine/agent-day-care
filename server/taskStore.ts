import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Remembers each thread's mission (first ask) and latest task across restarts,
 * since the Cloud Agents API cannot backfill past instructions. Deliberately
 * tiny: one gitignored JSON file, debounced writes, nothing else persisted.
 */

export type TaskMemory = Record<string, { mission?: string; task?: string }>;

const STORE_PATH = new URL("../.daycare-tasks.json", import.meta.url).pathname;
const SAVE_DEBOUNCE_MS = 1000;

export function loadTaskMemory(): TaskMemory {
  if (!existsSync(STORE_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as TaskMemory;
    console.log(`[tasks] remembered asks for ${Object.keys(parsed).length} threads`);
    return parsed;
  } catch {
    return {};
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;

export function saveTaskMemory(memory: TaskMemory): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    try {
      writeFileSync(STORE_PATH, JSON.stringify(memory, null, 2) + "\n");
    } catch (err) {
      console.warn("[tasks] save failed:", err);
    }
  }, SAVE_DEBOUNCE_MS);
}
