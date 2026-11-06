// Serves the static export the way Sites does: files from dist/client, `/` as index.html.
// With BASE_PATH, mounts dist/client there instead, as GitHub Pages does.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { port: { type: "string", default: "4173" } } });
const base = process.env.BASE_PATH ?? "";
const root = fileURLToPath(new URL("../dist/client/", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.statusCode = 400;
    return response.end("Bad request");
  }
  if (base && pathname === base) {
    response.writeHead(301, { Location: base + "/" });
    return response.end();
  }
  if (base) pathname = pathname.startsWith(base + "/") ? pathname.slice(base.length) : "/__outside_base__";
  const file = join(root, normalize(pathname === "/" ? "/index.html" : pathname));
  try {
    if (!file.startsWith(root) || (request.method !== "GET" && request.method !== "HEAD")) throw new Error();
    const body = await readFile(file);
    response.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    if (pathname.startsWith("/_next/static/"))
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else response.setHeader("Cache-Control", "no-cache");
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(await readFile(join(root, "404.html")).catch(() => "Not found"));
  }
}).listen(Number(values.port), "127.0.0.1");
