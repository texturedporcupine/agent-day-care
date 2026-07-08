import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Dependency-free static file server for the built Vite client (dist/). It lives
 * on the same http server as the bus + webhooks so `npm start` serves the whole
 * dashboard from one port. No framework: node:fs + node:path is plenty for a
 * handful of hashed assets plus an index.html SPA fallback.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Content-type for a path by extension; unknown types are served as bytes. */
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Map a request URL onto a file path inside distDir, or return null if it would
 * escape the directory. This is the directory-traversal guard: we decode, drop
 * the query/hash, resolve against distDir, and confirm the result stays under
 * distDir before any fs access happens. "/" maps to index.html.
 */
export function resolveStaticPath(distDir: string, url: string): string | null {
  const root = resolve(distDir);
  const rawPath = url.split(/[?#]/, 1)[0] ?? "/";

  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding is never a valid file request.
    return null;
  }

  // Reject NUL bytes outright; they can truncate paths in native fs calls.
  if (pathname.includes("\0")) return null;

  const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const candidate = relative === "" ? "index.html" : relative;
  const resolved = resolve(join(root, candidate));

  if (resolved !== root && !resolved.startsWith(root + sep)) return null;
  return resolved;
}

/**
 * Build a request handler that serves files from distDir. Real files stream with
 * their content-type; anything else falls back to index.html so the single-page
 * app boots on any path. Only GET/HEAD are answered; traversal attempts get 403.
 */
export function createStaticHandler(distDir: string) {
  const root = resolve(distDir);
  const indexPath = join(root, "index.html");

  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }

    const resolved = resolveStaticPath(root, req.url ?? "/");
    if (resolved === null) {
      res.writeHead(403).end();
      return;
    }

    // Serve the resolved file when it exists, otherwise fall back to the SPA
    // shell (index.html). A missing shell means the client was never built.
    const filePath = existsSync(resolved) && statSync(resolved).isFile() ? resolved : indexPath;
    if (!existsSync(filePath)) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, { "content-type": contentTypeFor(filePath) });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath)
      .on("error", () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      })
      .pipe(res);
  };
}
