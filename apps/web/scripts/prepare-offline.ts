import { createHash } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { build as bundleWorker } from "vite";
const root = "dist/client";
// BASE_PATH (next.config.ts) serves the app under a sub-path, e.g. /mogi-on-rails on GitHub Pages.
const basePath = process.env.BASE_PATH ?? "";
if (!/^(\/[\w.-]+)*$/.test(basePath)) throw new Error(`BASE_PATH must look like /mogi-on-rails, got "${basePath}".`);
const appRoot = basePath + "/";
if (basePath) {
  // The export nests a sub-path build under dist/client/<base> beside <base>.html; the host
  // mounts dist/client at the base instead, so lift both to the top.
  const nested = path.join(root, basePath);
  for (const name of await readdir(nested)) await rename(path.join(nested, name), path.join(root, name));
  await rm(nested, { recursive: true });
  await rename(nested + ".html", path.join(root, "index.html"));
  const file = path.join(root, "manifest.webmanifest");
  const webManifest = JSON.parse(await readFile(file, "utf8"));
  for (const key of ["id", "start_url", "scope"]) webManifest[key] = appRoot;
  for (const icon of webManifest.icons) icon.src = appRoot + icon.src.replace(/^\//, "");
  await writeFile(file, JSON.stringify(webManifest, null, 2) + "\n");
}
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => (e.isDirectory() ? files(path.join(directory, e.name)) : [path.join(directory, e.name)])),
    )
  ).flat();
}
const entries = [];
for (const file of (await files(root)).sort()) {
  const url = appRoot + path.relative(root, file).split(path.sep).join("/");
  if (["_headers", "sw.js", "offline-version.json"].some((name) => url === appRoot + name)) continue;
  // Static hosts redirect /index.html to /, which the worker caches on its own.
  if (url.endsWith(".html")) continue;
  const bytes = await readFile(file);
  entries.push({
    url,
    hash: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  });
}
if (basePath) {
  // A root-absolute app URL would load from the host root, outside the app and its worker scope.
  const rootAbsolute =
    /["'`(]\/(?:_next|ocr|icons|tracks|licenses|favicon\.svg|manifest\.webmanifest|sw\.js|offline-version\.json)\b/;
  const leaks = [];
  for (const file of await files(root))
    if (/\.(html|css|webmanifest)$/.test(file) && rootAbsolute.test(await readFile(file, "utf8")))
      leaks.push(path.relative(root, file));
  if (leaks.length) throw new Error(`Root-absolute URLs in a BASE_PATH build: ${leaks.join(", ")}`);
}
const manifest = JSON.parse(await readFile(path.join(root, ".vite/manifest.json"), "utf8"));
const entry = manifest["virtual:vinext-app-browser-entry"].file;
// Changing writer compatibility must also create a distinct cache generation.
const writerProtocol = "tracker-cas-capture-review-v1";
const build = createHash("sha256").update(JSON.stringify({ writerProtocol, entries })).digest("hex").slice(0, 24);
const inventory = { build, writerProtocol, entries, entry, root: appRoot };
const bundled = await bundleWorker({
  configFile: false,
  build: {
    write: false,
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    lib: { entry: "workers/offline.ts", name: "MKWOffline", formats: ["iife"] },
  },
});
const output = Array.isArray(bundled) ? bundled[0] : bundled;
if (!("output" in output)) throw new Error("Worker build did not produce a standalone script.");
const code = output.output.find((file) => file.type === "chunk")?.code;
if (!code) throw new Error("Standalone worker output missing.");
await writeFile(path.join(root, "sw.js"), `const INVENTORY=${JSON.stringify(inventory)};\n${code}`);
await writeFile(path.join(root, "offline-version.json"), JSON.stringify({ build }));
await writeFile(
  path.join(root, "_headers"),
  `${appRoot}_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n${appRoot}sw.js\n  Cache-Control: no-cache\n  Content-Type: application/javascript\n${appRoot}offline-version.json\n  Cache-Control: no-cache\n`,
);
console.log(
  `Offline inventory ${build}: ${entries.length} resources, ${entries.reduce((sum, e) => sum + e.size, 0)} bytes.`,
);
