import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

// Two real production worker generations, with distinct content inventories.
// The app and its assets come from the build served by npm start (scripts/serve-static.mjs), without SW/cache/IDB mocks.
export async function serveUpdateGenerations(upstream: string) {
  const worker = await readFile(new URL("../dist/client/sw.js", import.meta.url), "utf8");
  const firstLine = worker.slice(0, worker.indexOf("\n"));
  const original = JSON.parse(firstLine.slice("const INVENTORY=".length, -1));
  let generation = 0;
  let resourceFailure = false;
  let releaseRequests = 0;
  const inventory = () => {
    const content = `Release ${generation}`;
    const entries = [
      ...original.entries,
      {
        url: "/__test_release__.txt",
        hash: createHash("sha256").update(content).digest("hex"),
        size: Buffer.byteLength(content),
      },
    ];
    const build = createHash("sha256")
      .update(JSON.stringify({ writerProtocol: original.writerProtocol, entries }))
      .digest("hex")
      .slice(0, 24);
    return { ...original, entries, build };
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, "http://localhost").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/sw.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(`const INVENTORY=${JSON.stringify(inventory())};\n${worker.slice(firstLine.length + 1)}`);
      } else if (pathname === "/offline-version.json") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ build: inventory().build }));
      } else if (pathname === "/__test_release__.txt") {
        releaseRequests++;
        response.statusCode = resourceFailure ? 503 : 200;
        response.end(`Release ${generation}`);
      } else {
        const fetched = await fetch(new URL(request.url!, upstream), { redirect: "manual" });
        response.statusCode = fetched.status;
        for (const [name, value] of fetched.headers) {
          if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(name))
            response.setHeader(name, value);
        }
        response.end(Buffer.from(await fetched.arrayBuffer()));
      }
    } catch {
      response.statusCode = 502;
      response.end("Generation server failed");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing generation server address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    build: () => inventory().build as string,
    advance: () => {
      generation++;
    },
    failResource: () => {
      resourceFailure = true;
    },
    recoverResource: () => {
      resourceFailure = false;
    },
    releaseRequests: () => releaseRequests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
