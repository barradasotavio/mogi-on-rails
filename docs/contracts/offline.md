# PWA and silent offline cache

Manifest in `apps/web/public/manifest.webmanifest`. The browser and the installed app may have separate data; the ZIP is the backup and transfer mechanism. Everything is local: data lives on the device and the ZIP is the only transport; Discord integration is out of scope.

## Silent preparation

With the service worker controlling the page and the app idle, the app downloads and verifies the inventory and warms OCR in the background (`precacheWhenIdle`/`warmCachedOCRWhenIdle` in `lib/offline/client.ts`). Readings and app opening take precedence.

Preparation is invisible in the interface, including Settings, status, toasts and panels. A failure stays silent and is retried only at the next opening. A complete content version is reused as is.

**Readiness** = authorized page, every resource and a functional OCR test confirmed in the controlling worker's cache.

### Inventory and integrity

`scripts/prepare-offline.ts` (postbuild) generates the `dist/client` inventory with SHA-256 and embeds it, with the content version, in the `/sw.js` generated from `workers/offline.ts`. OCR runtime and licenses in [ocr.md](ocr.md).

Cache installation invariants, because the cache holds only build bytes, even when a login portal answers HTTP 200:

- same-origin credentialed download, direct response (a redirect fails) and body equal to the build hash;
- the root document is the MKW HTML with the expected entrypoint;
- cache marked complete only after initializing the build's PP-OCRv6 runtime.

The app may be served under a sub-path: `BASE_PATH=/mogi-on-rails` (GitHub Pages, `.github/workflows/pages.yml`) becomes `basePath` and `import.meta.env.BASE_URL`, and `prepare-offline.ts` lifts the nested export into `dist/client`, prefixes the manifest and inventory, gives the worker its scope root, and fails on a root-absolute URL left in HTML, CSS or the manifest. App code reaches every own URL through `withBase` (`lib/base-path.ts`); the default empty base keeps the root build unchanged.

Inter Variable is served locally through the inventory; `check:fonts` (`scripts/check-font-assets.ts`) requires every referenced `.woff2`.

### Failures and generations

A failure or quota error removes only the incomplete attempt; the previous complete version keeps serving its page and chunks, and personal data survives any quota shortage. Old caches stay while clients of the previous generation may exist.

The root page reopens only a generation whose marker declares the same concurrent-write protocol (`writerProtocol` in `scripts/prepare-offline.ts`); generations with another protocol or no marker require a new connected preparation. Reason: an authentic test (T11, `1cffa73`) lost data when a retained root, with an old full-write save, reopened beside an old window. Hence also the refusal to update with other windows open and the IndexedDB block on incompatible writers ([earlier writers](capture-sequence.md#older-writers)).

Without a complete version, controlled offline navigation shows a simple reconnect page.

## Installation

`installContext()` in `lib/install.ts` classifies the context; `beforeinstallprompt` is captured by an inline script in `<head>` and is used once.

Product decisions: how to install, and why (the browser is less likely to clear an installed app's storage), lives only in [Instructions](experience.md#instructions), for every system. The section shows this system's steps first (`installPlatform()`) and the others under "Other devices"; where the browser offers its own prompt (`prompt` context), it also shows Install App, the app's only install control, which opens that prompt and disappears once it is used. Settings, the mogi list and the opening show nothing about installing. Text in [copy.md](copy.md).

On desktop Chromium the installed app may draw into the title bar (`display_override: window-controls-overlay`); layout rules in [design system › desktop chrome](design-system.md#desktop-chrome).

## Navigation and updates

The SW serves same-origin GETs for inventoried resources and chunks from previous generations. Root navigation comes from the current generation's cache once it is complete, so a prepared app opens with no request; otherwise it goes to the network, bypassing the HTTP cache, and falls back to another complete generation only on transport failure; HTTP error responses arrive as they came. Updates are found by the browser's `/sw.js` check (`updateViaCache: "none"`). Worker, OCR, language data and RSC receive their own resource or the error; the HTML fallback applies only to navigation.

Updates follow the waiting worker and reload exactly once, keeping URL, mogi and Settings page. Rule in `decideUpdate` (`lib/offline/update.ts`):

- **Triggers**: opening, before any interaction; or a `hidden` page. Outside them, “Restart Now” in Settings.
- **Idle**: [`updateIdle` and `updatesBlocked`](../../apps/web/components/ui/update-activity.ts) guard tracker and surface activity; surface work is checked again at activation time.
- **Backup first**: writes the [automatic backup](backup.md#automatic-backups-before-updating); a failure blocks the attempt.
- **Other windows**: refuses, leaving them intact, and tries at the next trigger.

With an update pending, only Settings shows the refusal reason and the manual path (Save Backup in Storage).

Snapshots are validated on load and before saving. A client with an incompatible `state.version` blocks writing and directs the user to update while connected; updating the SW preserves saved data.

Screenshots come in only through Add Screenshots in an open mogi; the manifest has no Share Target.

## Evidence

Tests: `paddle-runtime.production.spec.ts` (cold page without network, OCR and manual association, no request but `/sw.js`), `automatic-backups.production.spec.ts` (generations, guard, backup, silent failures), `opening.production.spec.ts` (silent preparation), `install.spec.ts` (emulates contexts), `fonts.production.spec.ts`. Outside automated coverage: real suspension, physical quota and authentication. Physical limits in [quality.md](quality.md#physical-validation-limits).
