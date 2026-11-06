# Proportional validation

While changing code, run `npm test` and the focus that observes the affected behavior. Use the public `@mkw/engine` API for rules and a real browser for files, persistence, OCR and interaction. Documentation-only changes skip the application tests.

## Choosing the command

| Moment | Command | Scope | Budget |
| --- | --- | --- | --- |
| General iteration | `npm test` (= `npm run check:quick`) | Public engine rules, app rules (`test:app-rules`) and the quick journey in development Chrome. | 45 s |
| Localized change | `npm run test:focused -- tests/undo.spec.ts --grep 'Ctrl\+Z'` | Explicit app selection; each spec goes to the right server (below). | — |
| All app specs | `npm run test:browser:all` | All app specs, development and production. | — |
| Integration and pre-release | `npm run check` | Rules, types, lint/design, builds, Compiler, and all app specs. | 5 min |
| Rules | `npm run test:engine` | Only the public engine API. | — |

Budgets are checked at the end, with every test run; above them the command fails. Time spent waiting for the [browser slot](#execution-and-evidence) is excluded and recorded as `slotWaitMs` in `commands.json`.

## Two servers

- **Development** (`apps/web/playwright.config.ts`): the default for every spec. Before the workers start, `tests/warm-dev-server.ts` opens the app and imports the Vite fixtures once, because parallel workers on a cold Vite server miss the hydration deadline. Runs with `reducedMotion: "reduce"`, so sheets and alerts settle immediately. A test that observes motion (scroll edges, color transitions, scroll restoration) turns motion on with `page.emulateMedia({ reducedMotion: "no-preference" })` or `test.use({ contextOptions: { reducedMotion: "no-preference" } })`. Specs that mount a fixture through Vite (`/@fs`, `/@vite/client`, such as `question-session` and `mogi-render`) exist only here.
- **Production** (`apps/web/playwright.chrome-production.config.ts`): only `*.production.spec.ts`, the specs that need the build: `sw.js`, offline inventory, `offline-version.json`, compiled initial HTML or update generations (`opening`, `paddle-runtime`, `automatic-backups`, `fonts`). Name every new spec that reads these artifacts this way. The development config ignores these files; the production config keeps motion, because `opening` measures the fade.

`test:focused`, `test:browser:all` and `check` list the selection in both configs and send each part to its server. Before the production part, the build is redone when any file that feeds it (outside tests, Playwright configs and Markdown) is newer than `apps/web/dist/client/sw.js`. `test:focused` runs both parts before returning the first failure.

## Criteria for tests and checks

Every spec runs in `check`, and each test or check costs time in every integration. Be **minimal**: add only what protects a behavior nothing else protects. Before creating one, check each criterion:

1. **Observable behavior.** Assert what the user or the domain perceives: text, focus, persisted data, exported bytes, the open question. React state, the internal database and CSS classes come in only when they are the contract itself.
2. **Lowest layer that proves it.** A pure rule goes to the engine (`packages/engine/tests`) or to `apps/web/lib/**/*.test.ts`. Playwright is for what needs a real browser: layout, focus, gestures, files, IndexedDB, service worker, OCR. Real OCR runs only in `recognition-contract` and `paddle-runtime`; any other spec that adds images calls `useFixedRecognition(page)` (`tests/fixed-recognition.ts`) first, which reads saved readings of the fixtures on the development server.
3. **Extend before creating.** Look for the behavior in `apps/web/tests` and add the assertion to the existing spec. One rule, one test.
4. **One configuration.** One size, one theme, Chrome. Another width, theme or engine comes in only when the behavior changes with it; screenshots serve review, outside the gate.
5. **Deterministic and independent.** Tests run in parallel and in any order, each in its own context (its own IndexedDB, storage and service worker): a test builds every state it reads. Seed what it doesn't observe being built: `restoreState(page, mogiState({ roster, races, captures }))` (`tests/mogi-state.ts`, zipped by the real `createBackup` and restored through Settings), with the question fixtures in `tests/question-fixture.ts`. Drive the UI only for the flow under test, and download a backup only to assert its bytes. Wait for an observable state (visible dialog, `aria-busy="false"`, registration without a waiting worker). Polling messages to a service worker with pending activation keeps the old worker busy and delays activation.
6. **Right server.** Follow [Two servers](#two-servers): `*.production.spec.ts` only for what reads the build.
7. **Fixed bug, one regression test**, at the lowest layer where the bug goes red before the fix.
8. **Within budget.** A change that goes past 45 s in `npm test` or 5 min in `check` removes, merges or demotes another test in the same PR. The budget rises only by maintainer decision.
9. **New check** (lint rule, script) only for a rule that has already been broken and escapes cheap review. It is fast and its message names the rule and the file.
10. **Delete alongside.** When touching an area, remove in the same change the tests and checks that became redundant.

Chrome only. WebKit comes in only when there is a concrete, relevant difference reproduced in the current product; document the difference and add the targeted case. Physical devices: [limits](#physical-validation-limits).

The real batch has a measurement outside the gate: `npm run benchmark:engine` ingests the fixture's 13 readings through the app adapter; `CI=1 PORT=5531 VALIDATION_OUTPUT=/tmp/mkw-batch BATCH_CAPTURES_DIR=/path/to/13/originals npm run benchmark:browser` measures real OCR in Chrome at 375×812. The originals stay local; the reference results live in `scripts/benchmarks/batch-speed.json`. `question-crop.spec.ts` also depends on `BATCH_CAPTURES_DIR` and runs only when it is set.

## Execution and evidence

Pick a free `PORT` and a new `VALIDATION_OUTPUT`, for example `CI=1 PORT=5527 VALIDATION_OUTPUT=/tmp/mkw-integration npm run check`. The reports (`commands.json`, Playwright JSON, and one log per static step, since those run in parallel) land in `VALIDATION_OUTPUT`.

The root npm commands take the shared browser slot (`scripts/run-browser.py`), a machine-wide lock: one worktree's browsers run at a time, whatever the port. Playwright runs from `apps/web`, where its configs live. For direct Playwright, use `cd apps/web && CI=1 PORT=5527 python3 ../../scripts/run-browser.py -- npx playwright test --config playwright.config.ts tests/data-contracts.spec.ts --output=/tmp/mkw-data`, and take the slot at one level only.

Inside the slot, both configs run `fullyParallel` on a quarter of the cores (`availableParallelism() / 4`, 3 on a 12-core Mac), so the maintainer can still use the machine. Leave `--workers` to the configs. Six workers measured faster but overloaded the machine and timed out the Vite fixture, OCR and long-task specs.

Each worktree has its own dependencies, caches, build and test profile. Install at the root; `npm ci` can delete caches in use by another preview.

Keep failed attempts and repeat only the affected focus. Persistence and offline run for real: real storage and service worker, every test run and the product's timeouts. The Compiler uses the supported Vinext/OXC option and is checked in the production artifact; the build fails on any Compiler diagnostic (`panicThreshold: "all_errors"`). The TypeScript scripts require the Node range declared in the manifest.

## Production build

The build is a static export ([ADR 0007](../adr/0007-static-site-without-server.md)): `dist/client` holds `index.html`, the assets, `sw.js` and `_headers`. `.openai/hosting.json` holds the ChatGPT Sites project's private identity and `static.directory`. It stays untracked: keep the local copy and its `project_id` across updates; a build without it, such as the GitHub Pages build, skips it. Sites publishes that directory with no Worker; static mode rejects D1, R2, capabilities and migrations. `npm run start` (`scripts/serve-static.mjs`) serves `dist/client` for the production specs. `tsconfig.sw.json` typechecks the service worker.

The `managed-linux` profile (`scripts/hosting/`, plus `build-verified.sh` and `sites-env.sh` in `apps/web/scripts`) only sets up installs and bounded builds in the Codex Sites container.

## Physical validation limits

Device evidence comes only from a physical device; emulation, mobile viewport on desktop and WebKit stay outside it. Pending physical verification: all of Android (installation, files, OCR, persistence, lifecycle); on iPhone, OCR with the network off, PNG/text/ZIP/restore, update followed by offline reopening, and suspend/resume. Only observations after the spec29 UX validate the current implementation. 10/11-player scales and complete animations await an authentic capture. A future physical campaign defines its own scope and criteria and separates direct observation from user report.
