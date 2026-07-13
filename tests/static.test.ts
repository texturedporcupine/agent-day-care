import { describe, it, expect } from "vitest";
import { resolve, join, sep } from "node:path";
import { contentTypeFor, resolveStaticPath } from "../server/static.js";

/**
 * These cover the two pieces of pure logic in the static handler: extension ->
 * content-type, and the directory-traversal guard. Anything resolving outside
 * dist/ must return null so the handler can 403 it before touching the disk.
 */
const DIST = resolve("/srv/app/dist");

describe("contentTypeFor", () => {
  it("maps known extensions to their content-type", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("assets/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("assets/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("logo.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("icon.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for unknown or missing extensions", () => {
    expect(contentTypeFor("data.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
  });
});

describe("resolveStaticPath", () => {
  it("maps / to index.html", () => {
    expect(resolveStaticPath(DIST, "/")).toBe(join(DIST, "index.html"));
  });

  it("resolves normal asset paths inside dist", () => {
    expect(resolveStaticPath(DIST, "/assets/app.js")).toBe(join(DIST, "assets", "app.js"));
  });

  it("strips query and hash before resolving", () => {
    expect(resolveStaticPath(DIST, "/assets/app.js?v=123")).toBe(join(DIST, "assets", "app.js"));
    expect(resolveStaticPath(DIST, "/index.html#top")).toBe(join(DIST, "index.html"));
  });

  it("never resolves outside dist for traversal attempts", () => {
    // The guarantee is that ".." can never climb above dist: every result is
    // either rejected (null) or stays contained within dist, so a "../etc/passwd"
    // is neutralized to a (harmless, non-existent) path inside dist.
    for (const url of [
      "/../secret",
      "/../../etc/passwd",
      "/..%2f..%2fetc/passwd",
      "/assets/../../secret",
      "/%2e%2e/%2e%2e/secret",
      "/foo/../../../bar",
    ]) {
      const result = resolveStaticPath(DIST, url);
      const contained = result === null || result === DIST || result.startsWith(DIST + sep);
      expect(contained).toBe(true);
    }
  });

  it("returns null for malformed percent-encoding and NUL bytes", () => {
    expect(resolveStaticPath(DIST, "/%E0%A4%A")).toBeNull();
    expect(resolveStaticPath(DIST, "/foo%00.js")).toBeNull();
  });
});
