# @mkw/engine

Shared recognition, calculation and analysis for Mogi on Rails.

## Public boundaries

| Entry | Owns |
| --- | --- |
| `@mkw/engine` | Pure domain: calculations/standings, track standings (`trackStandings`), participation, accepted sequence/ordering, reconstruction/search, clarification descriptors, semantic answer application. Plain data in and out; storage and UI live in the app. |
| `@mkw/engine/browser` | Local image recognition and roster-association suggestions, kept apart so pure consumers load neither PaddleOCR nor Canvas. |

- Import only these entries; internal helpers stay private, app compatibility paths included.
- A `Mogi` is a value: change it by replacing it. The engine finds proofs and coverage projections once per object (`provenIntervals`, `coverageProjection`), so a mogi changed in place keeps its earlier totals.
- Dependencies point one way: the app imports these entries directly, and each algorithm lives once, in the engine.
- App state extends domain projections with originals, drafts and persistence metadata; generic mutations preserve that metadata.
- The sequence invalidation signature carries the app's opaque `contextDraft` marker (`src/domain/sequence/sequence-input-signature.ts`) to keep accepted-source guards; the engine passes it through untouched.

## Layout

- `src/index.ts` and `src/browser.ts` are the two entries, each listing its exports by name. A name enters an entry only when the app or the engine tests import it.
- `src/recognition/` holds browser-only reading; `src/domain/` holds the pure domain, one folder per glossary concept (`capture`, `numeric-readings`, `names`, `participation`, `sequence`, `reconstruction`, `questions`, `scoring`, `tracks`, `mogi`), with the shared records in `domain/types.ts`. `sequence/room/` holds the room analysis behind `analyzeRoomSequence`.
- New code goes in the folder of the concept it decides. A large module keeps its entry file as its interface (`sequence.ts`, `room/room-sequence.ts`) and moves each concept it decides into a sibling file.

## Readability

The engine is meant to read as a guide to the domain, in [GLOSSARY.md](../../GLOSSARY.md) words. Its rules:

- **A rule is a name.** Each domain rule is an exported function named after what it decides; limits and search budgets are named constants at the top of their module, each with a one-line why. Contracts link the name instead of restating the rule. Tests go through the public `@mkw/engine` API with glossary-worded titles that may cite the rule name.
- **Soft ceiling.** About 400 lines per module and 60 per function. Split only where a glossary concept emerges, never to hit a number.
- **English and formatted.** `npm run lint` runs `scripts/check-english.mjs` (no Portuguese in the engine or `apps/web`; mark genuine data with `english-check: data`) and Prettier over `packages/engine`; `npm run format` fixes formatting.

## Recognition

- `recognizeImage` takes only the image and leaves missing names empty; it keeps raw names, scores, alternatives, crop locations and reasons. Images stay on the device.
- `matchRows` proposes associations for review; a suggestion stays distinct from observed spelling and confirmed identity.
- `prepareRecognition` warms the shared runtime during offline preparation; the engine owns the worker lifecycle.
- Runtime, crops, read policy and focused validation: [ocr.md](ocr.md).

## Accepted evidence

`captureBoundaryValues(capture)` reads only accepted final-screen cumulatives (the app's associations and answers). With a Mogi argument, it also admits a corroborated pre-race adding column (`settledBeforeAdding`, [capture sequence](capture-sequence.md#numeric-readings)); observed spelling stays separate from accepted IDs and manual values, and unread names stay unresolved, distinct from absent. Raw observations alone never establish a Lounge participant, an absence, chronology, absolute race numbers, zero origin, counted scope or Lounge results.

## Sequence and source relations

- `reconcileSequence` re-evaluates accepted facts, preserving source metadata and retractable projections. `analyzeOrder` leaves results in their accepted order; an interrupted search stays incomplete.
- `captureExplanation` only reports the decisions reconciliation recorded. The app's `rulePhrases` (`apps/web/lib/mogi/capture-explanation.ts`) must cover the closed `RuleCode` union. Race values use the counted Lounge number.
- `analyzeCaptures` projects the app's accepted sequence and its current clarification questions from the Mogi; it takes no raw observations.

## Reconstruction and clarification

- Only a complete unique search may confirm a result; changed evidence withdraws dependent conclusions, with history kept ([reconstruction.md](reconstruction.md)).
- `applySequenceAnswer` applies answers to question descriptors with stale-source and range checks.
- Transactions, drafts, image ownership and presentation stay in the product.

## Thirteen-capture regression

`tests/fixtures/thirteen-captures.json` holds the user-provided OCR snapshot, image hashes and an independently checked twelve-race finish-order reference; recognition rules stay generic, free of these filenames and names. Real OCR on the 13 originals is measured by `npm run benchmark:browser` ([quality.md](quality.md)).

## Game screens

- `CaptureInterpretation.screen` names the game screen; the pure `screens` catalog (`src/domain/capture/screens.ts`) owns every per-screen property, derived by `screenProperties`. `unknown` leaves the moment open.
- Observed positions, movement, groups and native scale stay observations; accepted context and sequence moments stay facts, validated against a recognized screen.
