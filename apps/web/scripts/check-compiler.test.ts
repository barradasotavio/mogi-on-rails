import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-compiler.ts", import.meta.url));
const compiled =
  "function Tracker(){let $=cache(1),view;return $[0]===Symbol.for(`react.memo_cache_sentinel`)?($[0]=view=render()):view=$[0],view}export{Tracker};";
const runtime = 'const sentinel=Symbol.for("react.memo_cache_sentinel");export{sentinel};';

async function verify(application: string, framework = runtime, includeApplication = true) {
  const directory = await mkdtemp(path.join(tmpdir(), "mkw-compiler-gate-"));
  try {
    const client = path.join(directory, "dist/client");
    await mkdir(path.join(client, ".vite"), { recursive: true });
    await writeFile(
      path.join(client, ".vite/manifest.json"),
      JSON.stringify({
        ...(includeApplication
          ? { "components/tracker.tsx": { src: "components/tracker.tsx", file: "tracker.js" } }
          : {}),
        "_framework.js": { file: "framework.js" },
      }),
    );
    await writeFile(path.join(client, "tracker.js"), application);
    await writeFile(path.join(client, "framework.js"), framework);
    return spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("accepts compiler guards in the manifest application chunk without UI wording", async () => {
  const result = await verify(compiled);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects compiler markers found only in a framework chunk", async () => {
  const result = await verify("export function Tracker(){return null}", compiled);
  assert.equal(result.status, 1, result.stdout);
});

test("rejects a sentinel declaration without a compiled memo-cache guard", async () => {
  const result = await verify(runtime);
  assert.equal(result.status, 1, result.stdout);
});

test("rejects transformed code that has no application identity in the manifest", async () => {
  const result = await verify(compiled, runtime, false);
  assert.equal(result.status, 1, result.stdout);
});
