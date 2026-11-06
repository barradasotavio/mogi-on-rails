/// <reference types="vite/client" />
/** Where the app is served: "/" by default, "/mogi-on-rails/" when built with BASE_PATH (next.config.ts).
 * Node scripts that import app modules have no `import.meta.env`, so they get the root. */
export const base: string = import.meta.env?.BASE_URL ?? "/";
/** A root-relative app path ("/sw.js", "/?mogi=1") under the base. */
export const withBase = (path: string) => base + path.replace(/^\//, "");
