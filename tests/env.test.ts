import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../server/env.js";

/**
 * Guards the exact behavior main.ts and the emitter rely on: a repo-root .env is
 * loaded when present, real process.env always wins over file values, and an
 * absent file is a harmless no-op (so the zero-config mock quick-start works).
 */
describe("loadEnv", () => {
  const injected = ["DAYCARE_TEST_PREEXISTING", "DAYCARE_TEST_NEW"];
  let dir: string | null = null;

  afterEach(() => {
    for (const key of injected) delete process.env[key];
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  it("loads values from the file but never overrides existing process.env", () => {
    dir = mkdtempSync(join(tmpdir(), "daycare-env-"));
    const path = join(dir, ".env");
    writeFileSync(path, "DAYCARE_TEST_PREEXISTING=fromfile\nDAYCARE_TEST_NEW=fromfile\n", "utf8");

    process.env.DAYCARE_TEST_PREEXISTING = "fromenv";
    loadEnv({ path });

    // Real environment wins; only the previously-unset var is filled in.
    expect(process.env.DAYCARE_TEST_PREEXISTING).toBe("fromenv");
    expect(process.env.DAYCARE_TEST_NEW).toBe("fromfile");
  });

  it("is a no-op (does not throw) when the file is absent", () => {
    dir = mkdtempSync(join(tmpdir(), "daycare-env-"));
    const missing = join(dir, ".env");
    expect(() => loadEnv({ path: missing })).not.toThrow();
    expect(process.env.DAYCARE_TEST_NEW).toBeUndefined();
  });
});
