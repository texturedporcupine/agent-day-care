import { config, type DotenvConfigOptions } from "dotenv";

/**
 * Load a repo-root `.env` into process.env if one exists. Called once at the
 * server entrypoint (native `npm start`/`tsx watch` and the esbuild-bundled
 * production server all go through server/main.ts).
 *
 * Semantics we rely on, all provided by dotenv:
 *  - a missing `.env` is a no-op (never throws) so the mock quick-start keeps
 *    working with zero configuration;
 *  - existing process.env values are NOT overridden, so real environment
 *    variables (CI, shell exports, docker-compose `environment:`) always win
 *    over file values;
 *  - `quiet` suppresses dotenv's startup banner so boot logs stay clean.
 */
export function loadEnv(options: DotenvConfigOptions = {}): void {
  config({ quiet: true, ...options });
}
