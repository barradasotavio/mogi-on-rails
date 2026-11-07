# OCR and captures

Flow: screenshot on the Switch → Nintendo Switch App if needed → gallery → browser photo picker. Images stay on the device. PP-OCRv6 Tiny, through the official PaddleOCR.js 0.4.2 SDK, detects and recognizes in a worker; models and Wasm come from the app's origin. Configuration: `recognitionConfiguration` (`packages/engine/src/recognition/configuration.ts`).

## OCR runtime

- `npm run prepare:ocr` (before dev/build) checks the hashes in `packages/engine/scripts/paddle-models.json`, downloads once from the official PaddlePaddle repository on Hugging Face and generates `public/ocr` (ignored by Git). The build ships only the `OCR_MODEL` model (Tiny by default; `small` for comparison) and the PaddleOCR, OpenCV and ONNX licenses under `/ocr`.
- ONNX Runtime Web stays pinned at 1.24.3 across the whole tree: it is the SDK worker's version and keeps the Wasm just under Cloudflare's 25 MiB per-asset limit.
- The model receives only the image; roster, references, expected names, association and manual answers stay in the app.

**Read policy.** Read the color crop and, only if the text comes back empty, the grayscale contrast crop. Both attempts stay in the observations; the empty rule applies regardless of score. Reason (an experiment with Small, since removed): contrast only on empty got 37/40 fields right, against 34/40 for color only and 32/40 for contrast everywhere (which damaged names). Tiny is the default because, on the 13 real captures of a 2v2 mogi, it ended with the same questions and totals as Small, 2.5–3× faster. Small sample: `apps/web/benchmarks/ocr-scenarios.spec.ts` repeats the comparison with `OCR_MODEL`.

## Captures and crops

- Full 16:9 captures become 1920×1080; TV photos and crops are best effort.
- The original lives in a Blob, separate from the race's identity. Pixels and recognized text stay intact; corrections and accepted spellings sit beside them.
- Each row's `bounds` come from recognition; `captureRowBounds` (`packages/engine/src/domain/capture/row-bounds.ts`) is the only derivation for old captures. The ZIP rejects bounds outside the image.
- An invalid number or a score < 80 stays uncertain (`recognition/numbers.ts`, `recognition/general.ts`). Name identity comes only from association; score is reading confidence.
- Tiny misses a lone digit in a pre-race card's wide crop, such as each 0 before race 1, so an unread card total retries a tight crop that clips three digits: `readCardTotal` (`recognition/pre-race.ts`).
- The final standings list is in overall order, so confetti beside a total (a 91 read as 191) is a misread: up to two totals outside the longest non-increasing run stay uncertain, their reading kept, and the screen is still recognized: `interpretFinalList` (`recognition/general.ts`).
- Layouts and their decisions depend only on pixels; file name and hash stay out. Screens: [engine.md](engine.md#game-screens). Detection never relies on movement arrows or on header words, which change with the console's language: `overallStandingsRanks` (`packages/engine/src/recognition/finish-order.ts`) and `finalStandingsBanner` (`packages/engine/src/recognition/general.ts`).
- The pre-race map label names the next track in the console's language. The map moves the label with the track's marker, anywhere right of the cards, so the crop follows the banner: it finds the rows of white letters enclosed by black and centers on them, so short banners and dark ground still read: `trackBanner` (`recognition/track-banner.ts`). `matchTrack` (`packages/engine/src/domain/tracks/tracks.ts`) accepts a whole English or Brazilian Portuguese name or a Lounge code, else one name followed by stray letter fragments of up to two characters (`nameWithStrayFragments`; a digit is never noise, so numbered siblings never cross-match). The matched track stays English.

## Names and associations

The name grid, normalization and global assignment adapt LT at the commit in `THIRD_PARTY_NOTICES.md`. An empty reading, low confidence, a different name or a tie keep a question open until a human answers; “Not Sure” keeps it pending.

The engine assigns identities after reading, across the whole set, each person at most once, in one joint optimization: `jointNames` (`packages/engine/src/domain/names/joint-names.ts`; tests `ffa-names`, `team-identity`, `team-tags`). Its rules are named there: `tagBoundary`, `tiedPartitionLinks`, `tokenCandidates`, `tagAgreesWithAnchors`, `clearJointMargin` and `exclusionRow`. A row still open becomes a `NameQuestion` restricted to the free members; answering recomputes. Priority: [question queue](experience.md#question-queue).

`nameAssociations` stores answers per row, separate from the OCR text and the final position. A deduction (`origin: "deduced"`) stays automatic and correctable, distinct from human confirmation: `propagatedAssociation` (`packages/engine/src/domain/names/name-answers.ts`). Unlink writes `withdrawnAssociation` (`packages/engine/src/domain/names/synonyms.ts`) on every row of that spelling linked to the person, whatever the link's origin; recognition never relinks a withdrawn row ([spellings](capture-sequence.md#spellings)). The IGN learns only on a successful save, so cancel, “Not Sure” or failure discard the learning: `learnedIgn` (`packages/engine/src/domain/names/name-associations.ts`).

**Format.** IndexedDB version 4 ([earlier writers](capture-sequence.md#older-writers)); ZIPs with associations are version 3 ([versions](backup.md#versions)): the reader accepts 1–3, keeps origin absent in 1/2 and rejects association fields in a lower version.

## Finish-order stage

The animation stage and finish order come only from human confirmation, recorded in `stage: finish-order-confirmed` ([numeric readings](capture-sequence.md#numeric-readings)).

`interpretRightList` (`packages/engine/src/recognition/finish-order.ts`; tests `finish-order-representation`, `eleven-players`) classifies `finishOrderAdding`/`finishOrderAdded` (`showsFinishOrder`) and the room size (`representedRoom`, from `completeNativeScale` and `votedNativeScale`):

- Insufficient cues leave the type uncertain and the finish order open.
- Residual additions are partial, distinct from full gains. An illegible row stays an unread row even with the scale detected.
- A smaller room shown only by blank `rows` could hide unread names, so the race stays pending until `provesRoomSize` finds proof in another capture of the same room or the queue asks: `roomSizeNeedsAnswer` (`packages/engine/src/domain/numeric-readings/numeric-candidates.ts`; [copy](copy.md)).
- Incorporation uses `applyReviewedRace`, the same transition as the explicit flow; `numericAnswers` stays separate from OCR.

## Absences

An absence is always a human mark; an illegible name stays an unread row. A pixel heuristic skips OCR on near-empty crops. Three absences block normal confirmation (`domain/race-review.ts`).

## Batches and evidence

- Each image in the batch has its own review; failure or cancellation of another preserves what was confirmed. Gallery order is only the starting order ([sequence](capture-sequence.md)).
- Recognition reads each image once, at intake, and stores the readings; nothing reads a stored capture again, and a [compressed image](backup.md#compressed-images) is never read.
- An identical SHA-256 or identical readings only flag a repeat: the user chooses to keep it as evidence of an existing race or to confirm a new occurrence.
- Captures and races have independent IDs; removing or reassociating a capture preserves the race. Discarding an occurrence removes only its Lounge points.
- Context screens (`overallStandings`, `finalStandings`) serve only as context: finish order, result and number come from other screens. Partial rows leave player count and absence open. The mogi stays open after the game ends.

## Real fixtures

`npm run fixtures:ocr` (`apps/web/scripts/prepare-ocr-fixture.ts`) writes to `.fixtures` (ignored by Git) two 1920×1080 images that the author of issue [LT #12](https://github.com/PFQNiet/mkw-lounge-tracker/issues/12) published for testing, checked by SHA-256. The pixels stay only in `.fixtures`, outside the repository and the deployment: LT's MIT license covers the code, and the images belong to the issue author and Nintendo. [Uncolored](https://github.com/user-attachments/assets/79f485d6-22f3-4ab6-9b7e-144ed7d17bb4): points without cumulatives, Lounge names different from the IGNs. [Colored](https://github.com/user-attachments/assets/8f16f016-0822-4448-822b-3ecfc151b819): incomplete sum and residual +4/+1, which require human review.

spec29 captures: `apps/web/tests/fixtures/spec29` and `spec29-teams` (provenance in the READMEs). Stage detection, overall accuracy and performance on Android/iOS remain to be proven.

Fixtures carry no real player names. A screenshot's names are edited to Mario Kart character-style names that keep its reading difficulty and the context it was created for, checked with real `recognizeImage` before and after: [player names](../../apps/web/tests/fixtures/README.md#player-names).

## Focused validation

- Focused selection (Small read the same team totals in Chrome and WebKit), in Chrome: `paddle-runtime.production.spec.ts` (cold offline page, persisted manual association) and `recognition-contract.spec.ts` (a real team board read through `recognizeImage`: screen, names, scores and certain group totals; and the race 1 pre-race board, built from `pre-race-teams-655.jpeg` with its lone 0 on every card).
- Every other spec that adds images reads `apps/web/tests/fixtures/recognitions.json`: real `recognizeImage` output of those fixtures, swapped in on the development server only ([quality.md](quality.md)). A change to recognition output regenerates it: `UPDATE_RECOGNITIONS=1 npm run test:focused -- tests/fixed-recognition.spec.ts`.
- Chrome and WebKit read `teamStandings` the same with Paddle: WebKit comes in only on a concrete difference ([quality.md](quality.md)).
