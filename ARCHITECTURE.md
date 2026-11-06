# Architecture

Mogi on Rails is a static web app with no server ([ADR 0007](docs/adr/0007-static-site-without-server.md)). Everything below runs in the browser, on the player's device. Domain words (**mogi**, **capture**, **counted race**, **proven total**) are defined in [GLOSSARY.md](GLOSSARY.md); the rules themselves live in the contracts mapped in [docs/README.md](docs/README.md). This page is the route between them.

```text
Switch screenshot
  └─ recognition ............ @mkw/engine/browser   (PaddleOCR in a worker)
       └─ capture review .... apps/web/lib/captures, lib/mogi + components/captures
            └─ sequence and reconstruction ... @mkw/engine   (pure functions)
                 └─ standings, !submit, PNG ... apps/web/lib/mogi/exports.ts
storage, backup, offline .... apps/web/lib/mogi/storage.ts, lib/backup, lib/offline, workers/offline.ts
```

## Two packages

| Package | Role |
| --- | --- |
| `packages/engine` (`@mkw/engine`) | Recognition, calculation and inference, behind two entries: `@mkw/engine` (pure domain, plain data in and out) and `@mkw/engine/browser` (image recognition, which pulls in PaddleOCR and Canvas). |
| `apps/web` (`@mkw/web`) | The Vinext app: screens, persistence, backup, offline cache. It imports only the engine's two entries. |

Why one engine and one app: [ADR 0008](docs/adr/0008-monorepo-with-a-shared-engine.md). The engine's public boundary and readability rules: [engine contract](docs/contracts/engine.md). `apps/switch-airdrop` is a separate Swift helper for macOS, outside the npm workspaces.

## 1. Screenshot

The player adds Switch screenshots by picker, paste, drag or a watched folder. `apps/web/lib/images` fingerprints each file and fixes its **photo moment** once, at ingestion. Images stay on the device.

Rules: [capture sequence › photo moment](docs/contracts/capture-sequence.md#photo-moment), [experience](docs/contracts/experience.md).

## 2. Recognition (`@mkw/engine/browser`)

`apps/web/lib/captures/recognize.ts` calls `recognizeImage`, which crops the results screen and runs PP-OCRv6 Tiny in a worker. It returns raw observations (names, numbers, scores, crop locations) and knows nothing of the roster. `matchRows` then proposes which bot-list player each row is; a proposal stays a suggestion until the app accepts it.

Models are downloaded and hash-checked by `npm run prepare:ocr` and served from the app's own origin.

Rules: [OCR](docs/contracts/ocr.md).

## 3. Capture review (`apps/web`)

`lib/captures/read-captures.ts` reads a queue of images; `lib/mogi/ingestion.ts` and `lib/mogi/capture-review.ts` turn each reading into a capture on the mogi, persisted before the original is released. What stays uncertain becomes a question in the single queue ([ADR 0004](docs/adr/0004-single-question-queue.md)), built by `lib/mogi/questions.ts` and answered in `components/question-sheet.tsx` and `components/captures/`.

Rules: [capture sequence](docs/contracts/capture-sequence.md), [experience › questions](docs/contracts/experience.md).

## 4. Sequence and reconstruction (`@mkw/engine`)

Pure functions over an immutable `Mogi` value:

- the **sequence** decides which race each capture belongs to and which races were counted, from named rules;
- **reconstruction** proves totals across gaps from game cumulatives, and withdraws a conclusion when its evidence changes;
- **scoring** applies the Lounge points scale and produces the standings and the `!submit` command.

Rules: [capture sequence](docs/contracts/capture-sequence.md), [reconstruction](docs/contracts/reconstruction.md), [scoring](docs/contracts/scoring.md). The mogi stays open after twelve races ([ADR 0003](docs/adr/0003-finished-mogi-without-closing.md)).

## 5. Storage, backup and offline (`apps/web/lib`)

| Concern | Code | Rules |
| --- | --- | --- |
| Mogis and images in IndexedDB, guarded against writes from another window | `lib/mogi/storage.ts`, `lib/images` | [capture sequence](docs/contracts/capture-sequence.md) |
| ZIP backup, restore and automatic backups | `lib/backup` | [backup](docs/contracts/backup.md) |
| Service worker, offline cache, OCR warm-up, updates | `workers/offline.ts`, `lib/offline`, `scripts/prepare-offline.ts` | [offline](docs/contracts/offline.md) |

The ZIP is the only way data leaves a device; there is no account and no sync.

## Interface

React with shadcn/ui on Radix, styled with Tailwind. Screens use only the internal component layer in `apps/web/components/ui`. Rules: [design system](docs/contracts/design-system.md), [experience](docs/contracts/experience.md), [copy](docs/contracts/copy.md). Interface and docs are English ([ADR 0002](docs/adr/0002-english-interface-and-documentation.md)).

## Validation

Engine rules are tested through the public API with `node --test`; app rules in `apps/web/lib/**/*.test.ts`; everything that needs a browser (files, IndexedDB, service worker, OCR) in Playwright specs under `apps/web/tests`. Which command to run and the budgets: [quality](docs/contracts/quality.md).
