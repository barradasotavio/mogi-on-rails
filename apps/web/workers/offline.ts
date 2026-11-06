/// <reference lib="webworker" />
// Generated with a build-specific inventory. No personal records enter CacheStorage.
declare const INVENTORY: {
  build: string;
  writerProtocol: string;
  entries: { url: string; hash: string; size: number }[];
  entry: string;
  /** The app page: "/", or "/mogi-on-rails/" for a BASE_PATH build. Every other URL sits under it. */
  root: string;
};
const sw = self as unknown as ServiceWorkerGlobalScope;
const prefix = "mkw-offline-";
const cacheName = prefix + INVENTORY.build;
const root = INVENTORY.root;
const marker = root + "__mkw_offline_complete__";
let attempt: AbortController | undefined;
const known = new Set(INVENTORY.entries.map((entry) => entry.url));
async function otherAppWindows() {
  const windows = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.filter((client) => new URL(client.url).pathname === root).length > 1;
}
async function complete(name = cacheName, requireCompatibleWriter = false) {
  const cache = await caches.open(name);
  const metadata = await cache.match(marker);
  if (!metadata || !(await cache.match(root))) return false;
  const saved = (await metadata.json()) as {
    entries: string[];
    writerProtocol?: string;
  };
  // Assets can be reused across releases; a reopened app must use a compatible writer.
  if (requireCompatibleWriter && saved.writerProtocol !== INVENTORY.writerProtocol) return false;
  for (const url of saved.entries) if (!(await cache.match(url))) return false;
  return true;
}
async function digest(buffer: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
sw.addEventListener("install", () => {
  /* Waiting updates never interrupt an active workflow. */
});
sw.addEventListener("activate", (event) => event.waitUntil(sw.clients.claim()));
sw.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  const reply = (value: object) => port.postMessage(value);
  event.waitUntil(
    (async () => {
      try {
        switch (event.data?.type) {
          case "status":
            reply({ build: INVENTORY.build, ready: await complete() });
            break;
          case "can-activate":
            reply({ otherWindows: await otherAppWindows() });
            break;
          case "activate": {
            if (await otherAppWindows()) throw new Error("Close the other windows of this app to finish the update");
            await sw.skipWaiting();
            reply({ ok: true });
            break;
          }
          case "cancel":
            attempt?.abort();
            reply({ ok: true });
            break;
          case "prepare": {
            if (attempt) throw new Error("Offline preparation is already running.");
            if (await complete()) {
              reply({ prepared: true });
              break;
            }
            const current = new AbortController();
            attempt = current;
            try {
              await caches.delete(cacheName);
              const cache = await caches.open(cacheName);
              let done = 0;
              for (const entry of INVENTORY.entries) {
                const response = await fetch(entry.url, {
                  cache: "no-store",
                  priority: "low",
                  credentials: "same-origin",
                  redirect: "error",
                  signal: current.signal,
                });
                if (
                  !response.ok ||
                  response.redirected ||
                  (await digest(await response.clone().arrayBuffer())) !== entry.hash
                )
                  throw new Error(
                    `Couldn't verify a resource: ${entry.url}. Check your connection and access to the site.`,
                  );
                await cache.put(entry.url, response);
                reply({
                  progress: ++done,
                  total: INVENTORY.entries.length + 1,
                });
              }
              const page = await fetch(root, {
                cache: "no-store",
                priority: "low",
                credentials: "same-origin",
                redirect: "error",
                signal: current.signal,
              });
              const html = await page.clone().text();
              if (
                !page.ok ||
                !page.headers.get("content-type")?.includes("text/html") ||
                !html.includes("Mogi on Rails") ||
                !html.includes(INVENTORY.entry)
              )
                throw new Error("The app page doesn't match its resources. Open the site and try preparing again.");
              await cache.put(root, page);
              reply({ prepared: true });
            } catch (error) {
              await caches.delete(cacheName);
              throw error;
            } finally {
              attempt = undefined;
            }
            break;
          }
          case "finalize": {
            const cache = await caches.open(cacheName);
            if (!(await cache.match(root))) throw new Error("The offline page is missing.");
            for (const entry of INVENTORY.entries)
              if (!(await cache.match(entry.url))) throw new Error("Offline preparation is incomplete. Try again.");
            await cache.put(
              marker,
              Response.json({
                entries: INVENTORY.entries.map((e) => e.url),
                preparedAt: Date.now(),
                writerProtocol: INVENTORY.writerProtocol,
              }),
            );
            reply({ ready: true, build: INVENTORY.build });
            break;
          }
          case "discard-incomplete":
            if (!(await complete())) await caches.delete(cacheName);
            reply({ ok: true });
            break;
        }
      } catch (error) {
        reply({
          error: error instanceof Error ? error.message : "Couldn't prepare offline resources.",
        });
      }
    })(),
  );
});
sw.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (url.origin !== sw.location.origin || request.method !== "GET") return;
  if (url.pathname === root + "offline-version.json") {
    event.respondWith(Promise.resolve(Response.json({ build: INVENTORY.build })));
    return;
  }
  if (known.has(url.pathname) || url.pathname.startsWith(root + "_next/static/")) {
    event.respondWith(
      (async () => {
        const own = await (await caches.open(cacheName)).match(url.pathname);
        if (own) return own;
        for (const name of await caches.keys())
          if (name.startsWith(prefix) && (await complete(name))) {
            const saved = await (await caches.open(name)).match(url.pathname);
            if (saved) return saved;
          }
        return fetch(request);
      })(),
    );
    return;
  }
  if (request.mode === "navigate" && url.pathname === root) {
    event.respondWith(
      (async () => {
        // A complete generation opens with no request; updates arrive through the /sw.js check.
        if (await complete(cacheName, true)) return (await (await caches.open(cacheName)).match(root))!;
        try {
          return await fetch(request, { cache: "no-store" });
        } catch {
          const names = (await caches.keys()).filter((name) => name.startsWith(prefix) && name !== cacheName).reverse();
          for (const name of names)
            if (await complete(name, true)) return (await (await caches.open(name)).match(root))!;
          return new Response(
            '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mogi on Rails · Reconnect</title><h1>Offline resources are incomplete</h1><p>Reconnect, open the app and finish preparing on this device. Your mogis are safe.</p><a href="' +
              root +
              '">Try again</a></html>',
            {
              status: 503,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
              },
            },
          );
        }
      })(),
    );
  }
});
