# Static site, no server

The app is a Vinext static export (`output: "export"`) published on ChatGPT Sites in static mode (`static.directory` in `.openai/hosting.json`), with no Worker. Once the offline cache is complete, the service worker serves the root page from cache, so opening and using the app make no requests except the browser's `/sw.js` update check. Features that need a server (SSR, server actions, route handlers, Sites sign-in, D1, R2) are out: data lives on the device and the ZIP is the only transport.

Why Vinext and not plain Vite: the app is already one client page with its own `?mogi=` routing, so the export removes the server for a small diff and keeps the Compiler setup, metadata and asset paths. Plain Vite would remove `next` and RSC at the cost of rewriting the head, the Compiler check and the offline inventory paths, with no functional gain.
