import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist/client");
const origin = "https://build.invalid";
const entries = await readdir(root, { recursive: true, withFileTypes: true });
const errors: string[] = [];
let references = 0;
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
  const file = path.join(entry.parentPath, entry.name);
  const cssUrl = new URL(path.relative(root, file).split(path.sep).join("/"), origin);
  const css = await readFile(file, "utf8");
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi)) {
    const value = (match[1] ?? match[2] ?? match[3]).trim();
    const url = new URL(value, cssUrl);
    if (!url.pathname.toLowerCase().endsWith(".woff2")) continue;
    references++;
    const target = path.resolve(root, "." + decodeURIComponent(url.pathname));
    const asset = await stat(target).catch(() => undefined);
    if (url.origin !== origin || !target.startsWith(root + path.sep) || !asset?.isFile() || !asset.size)
      errors.push(`${path.relative(root, file)}: ${value} does not resolve to a local font file in dist/client`);
  }
}
assert.ok(references > 0, "No WOFF2 references found in the production CSS. Build first.");
assert.deepEqual(errors, [], "Production font assets must be served locally.");
console.log(`Production fonts verified: ${references} WOFF2 references resolve to emitted files.`);
