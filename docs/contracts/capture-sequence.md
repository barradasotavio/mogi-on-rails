# Capture ingestion and sequence

Recognition is persisted before `ingestCaptureReview` consumes the original, in the Tracker's serialized write. A source can enter as context only, without establishing a race or result. The unknown (name, number, relation) stays unknown, distinct from zero and from absence. The batch's provisional number and the selection or array order are input labels: eligibility and chronology come from the [named rules](#named-rules).

## Photo moment

`photoMoment: { at, source }` is computed once, at ingestion, by `apps/web/lib/images/photo-moment.ts` (priority `exif` → `switch-name` → `pasted` → `file-date`; cases in `photo-moment.test.ts`). `exif` reads DateTimeOriginal, else the main directory's DateTime, the only date the Switch writes into its own captures; loading and ZIP use the stored value. Only a paste sets `pasted`; images from a [watched folder](experience.md#watched-folders) go through ingestion as Add Images does. `file-date` counts only when it precedes receipt by more than 60 s: a date close to receipt is the copy's. Unknown or equal times supply no ordering evidence in epochs or tie-breaks, and neither does a moment several captures share to the second, a phone's batch save time (`sharedPhotoMoment`); distinct times break ties the totals cannot settle. EXIF comes only from JPEG; ingestion accepts PNG, JPEG and WebP, so HEIC stays out.

## Named rules

`analyzeRoomSequence` (`packages/engine/src/domain/sequence/room/room-sequence.ts`) decides the sequence from the current facts. Each rule is an exported function with its `RuleCode` in the comment. Tests exercise the rules through the public `@mkw/engine` API, with glossary-worded titles that may cite the rule name:

- Room sequence, in `packages/engine/src/domain/sequence/room/`: `raceNumberBySum`, `sharedPhotoMoment` (`room-boundary.ts`); `reopeningByTotals`, `precedesAnchor`, `answeredReopening`, `epochByPhotoTime` (`room-reopening.ts`); `answeredNumberTieBreak`, `photoTimeTieBreak`, `orderQuestion` (`room-order.ts`); `roomPositionsAgree` (`room-grouping.ts`); `continuityBySmallestDistance`, `roomStart`, `initialRoomByContinuity`, `raceNumberCandidates` (`room-start.ts`); `initialFactsFit`, `raceNumberWithinCeiling` (`room-projection.ts`); `initialRoomSources` (`room-sequence.ts`).
- Per-person vector (`per-person-vector.ts`): `vectorDistance`, `cumulativeInRange`, `rowAnchors`.
- [Numeric deduction](#numeric-deduction) (`numeric-deduction.ts`).

The limits (six shared people, strict majority, 82 per race, 15 per person) are named constants at the top of each module, with the reason.

## Rule 1 — Per-person continuity

- The scale follows the represented players: 82, 67 and 56 with 12, 11 and 10 ([scoring](scoring.md)). Whoever is missing from the capture leaves the comparison; an unknown identity or illegible reading counts as unknown, distinct from absence.
- Across a shrinking room, `vectorDistance` requires exactly one feasible race count over all mixes of room sizes between the boundaries; a single race requires distinct native gains. A number suggestion uses the smallest feasible count; only a reopening adds the preceding races to the room's cumulatives.
- A discarded occurrence advances cumulatives and physical position; the race number stays where it was.
- A pre-race source represents the next race; a post-race one, the race just completed (`momentOffset`). A lobby with the same cumulatives enters as context only.
- A distance greater than one race leaves the races in between pending, with only their place known; the proven contiguous prefix stays.
- A return or restart by a few people, with the others sustaining the step, opens a segment for them alone; it anchors another comparison from the second capture in the segment onward. A restart the room proves anchors at once: a legible total below the continuity value that fits what the person gained since the neighbour one race earlier (`restartedTotal`; when the room's sum filled in that neighbour total for an unreadable row, it bounds nothing and the reading stands while it fits the races played), or a row read only as zero where the race sum deduced a continuing total or deduced none (`restartedZeros`; OCR rates a lone "0" below certainty). A pre-race screen listing fewer players than the totals before it closes a race of unknown size, so its sum fills in nothing (`roomLeftBefore`). Source positions follow the shortest accepted comparisons race by race (`placeAlong`, `room-grouping.ts`); a longer comparison can hide a restart. Such a row is no misread, but it still counts as the one deviation `singleMisreadTotal` allows.
- Races entered by hand extend the anchor; a capture whose totals reach that anchor in native races was taken before them in the same room, not after a reopening (`precedesAnchor`), so entering a race keeps the numbers of the screens around it.
- Continuity requires at least one pair of shared legible cumulatives, all held or increasing. An unresolved group whose totals drop asks only "Which race is this?", on its first capture: a number above the preceding room's last race means a reopening; a lower number places it earlier. Established native first-race sums and unique starts stay automatic. Without a legible shared comparison to decide, the queue still asks about continuity ([copy](copy.md)); a numeric contradiction asks for the points to be checked.
- The finish order's size is the occupied extent (`representedPlayers`) of the OCR's twelve fixed rows; when it is undetermined, the queue asks.
- The analysis reads captures in photo order, and the queue orders captures without a number by photo time, so the outcome never depends on which reading finished first or on capture IDs. The stored order stays as ingested. The event-final screen closes the event, so a photo time earlier than the rest never makes it the first room (`selectRoom`); it continues from the previous vector, which proves its unread totals.
- Two unrelated groups of captures are joined where they meet: the continuity question shows the last screenshot of the earlier group beside the first of the later one (by number, otherwise by photo time), never the first race of each. Once that continuity is answered, or the shared totals continue, two groups with consecutive race numbers leave no gap, so the result can be final.
- A reopened room whose totals bound no race number still asks "Which race is this?" among the free races, so a race with an image never ends without a number or a question.
- A race has a slot before it and one after it: a pre-race screen and a result screen of the same race don't take each other's number. The number suggestion follows the numeric hint, then the races photographed earlier (a pre-race screen of race n counts n − 1). For a reopened room, when the preceding room's last race plus its highest local race is 11, two starts fit: suggest the later one, ending at race 12. Otherwise keep the photo-based suggestion.
- A result screen without one legible total (read mid-animation) takes the race whose established placements its accepted finish order repeats, when exactly one race does and no other result screen holds it (`finishOrderNumber`, `sequence.ts`).
- `raceQuestion` suggests a number first, then lists the other free candidates in numeric order; the reopening choice keeps its own options and numerically ordered `otherRaces`.
- An unrecognized screen with legible names asks "Which race is this?". Its answered number attaches the capture without inventing a result (`numberedCapture`); without coverage or an open question, `unrecognizedRaceNeedsImages` marks it `needs-images` (`no-later-totals`). A pre-race source alone stays pending (`preRacePending`).
- An unrecognized screen with no legible name (a game error, a loading screen) asks nothing, takes no race and leaves no pending question.

### Numeric deduction

Rules in `packages/engine/src/domain/numeric-readings/numeric-deduction.ts`: `firstRacePermutation`, `maxGameCumulative`, `cumulativeInRange` (`per-person-vector.ts`), `spuriousCharacterCandidate`, `missingTotalsByScale`, `roomLeftBefore`, `totalByRemainder`, `duplicateFirstRaceRows`, `zeroGameCumulativeColumn`, `zeroColumnRoomStart`; neighbour corroboration and restarts (`restartedTotal`, `restartedZeros`) in `numeric-continuity.ts`. Invariants:

- A spurious-character candidate is never a reading: only the vector corroborates it.
- A sum that fits no race count (83 in a scope of 12) is a conflict, never rounded.
- A room short of its native points (the game left a player's points out of a total) fits no sum from then on: an answered race number anchors its group, and per-person continuity places the rest. Without one, each total is asked once; once all are confirmed, the queue asks which race it is.
- A column of zeros and blanks, with read zeros (uncertain ones included) in a strict majority of represented rows, is race 1 unless another capture has a known earlier, distinct photo time, or an unordered capture supplies a competing zero column or a majority totals drop relative to its native result (`zeroColumnRoomStart`). Unknown or equal photo times alone never withdraw the start. A zero column answered above race 1 no longer competes for that start. Competing starts stay in separate rooms when their shared totals disagree at the same local position (`roomPositionsAgree`); when photo times can't order them, the unique longest contiguous room proven by totals starts at race 1, excluding rooms answered to start later (`initialRoomByContinuity`). Equal lengths without photo order stay unresolved. An answered capture still accepts that column as its room's start. Later zeros corroborated by a totals drop, including without photo order, supply only a local start until numbered (`zeroRoomBoundary`); a screen read mid-animation qualifies, with every zero uncertain and a lone "O" read as a zero glyph; they never automatically take the next mogi number. In a room whose own zero column already proves race 1, they keep that start (`roomStart`). An all-blank column stays unknown.
- `numericDeductions` stores the value and the `deduced` origin, both revisable; `numericRows` and `numericAnswers` stay intact, and the previous deduction stays out of the premises that recompute it.
- `singleMisreadTotal` keeps a capture at its sum-derived number when its neighbours corroborate every other readable row and exactly one unconfirmed total contradicts them. `neighbouringCumulatives` and `nativeCumulativeInterval` require the exact room sum and per-person native gains; competing corrections stay unresolved. `sequencingCumulatives` excludes the broken row from sequencing evidence; a points question suggests the corroborated total until answered, with OCR and answers preserved. A contradicted row never suggests its reading, nor does a reading that outgrows an earlier screen's total by more than fifteen points per race left (`beyondReach`, `mogi-questions.ts`); a confirmed total the room still contradicts returns once as `rejected`, with no suggestion. A screen repeating its anchor's totals takes the anchor's value for its one unread row (`duplicate.same-vector` in `deduceFromAnchor`).
- A race with a recognized result image is counted or keeps a question; a numbered unrecognized screen without a result needs images.
- The pre-race screen of race 1 asks no points: every total is zero there.

### Spellings

`spellingGroups` (`packages/engine/src/domain/names/spelling.ts`) groups readings: readings that differ only in spacing and punctuation are the same spelling, and close variants merge only when each capture carries at most one of them. The queue asks once per group, and the answer applies to the free, eligible variants. A single previous total equal to that of exactly one eligible, free person identifies the row without a question. Readings too short or too far apart to group ("EY" and "E") are tied by totals instead: in a full room, `continuingTotals` (`name-answers.ts`, rule `name.continuity`) pairs a screen's free rows with its free people when every linked screen of the same room at the same moment or one race away allows exactly one pairing (equal totals, or gains that complete the twelve native places). Two pairings that both fit, or a contradicting neighbour, still ask. It fills only open rows: answers and withdrawn rows stay.

A certain recognition stands on its own only while the reading still matches the person's current in-game name. Once the name changes, it counts as a synonym: "Read as X" lists it and Unlink withdraws it.

A link stays inside the participation span of its screenshot: its race, its number, the last race for final standings, or anyone holding a span when it has none. Every reconciliation (`reconcileSequence`, on each write and load) and participation change (`requireParticipationReview`) moves a link outside it to whoever holds that participation there (`withLinksInSpan`, `participation.ts`); with no holder, or one already linked, the row is asked again.

In a full room, an unlinked reading can only belong to someone already linked, most often a teammate whose name was swapped with it. So its question also offers the teammates of its options, and answering with one moves that person: the row they held in that capture is withdrawn and asked on its own (`answerNameQuestion`).

## Numeric readings

- `Capture.numericRows` stores the reading (text, value, confidence, alternatives, location) apart from corrections; `NumericAnswer` wins, and the OCR and original bytes stay. The right-hand field and the addition field are independent; in the addition crop, a gain requires `+` before the digit.
- The suggested step is a hint; cumulatives anchor only after the final step is confirmed ([OCR](ocr.md)). The `finishOrderAdding` animation stays out of final anchors; the overall standings order stays out of the finish order.
- [`settledBeforeAdding`](../../packages/engine/src/domain/capture/capture-boundary.ts) admits an adding screen's right column as a **before** boundary only when every represented identity in the same continuity segment has **right + native addition = adjacent total** (`addingTotalsAgree`). Incoming corroboration also checks the later column. `nativeAddingPoints` accepts a readable native addition or the same capture's independent accepted finish order. One uncorroborated or contradicting row excludes the column; `boundaryCompletedSteps` adjusts the moment. With no adjacent column, settled totals one unknown race earlier corroborate it instead (`gapCorroboratedValues`): every legible right total gains a distinct native twelve-room value, and at most one unread total takes the one value left, so that race is then reconstructed from both columns. Columns are prepared once per boundary analysis and only adjacent boundaries are compared.
- `Race.gameEvidence` stores values per effective identity and continuity segment. Cumulatives follow whoever played, separated by credit or substitution; the row → person association is independent of placements, so swapping positions keeps each number with its person.
- Only a complete, unique and compatible order search (`analyzeOrder`, [engine](engine.md)) supports [reconstruction](reconstruction.md); a search cut by its budget (`ORDER_SEARCH_MAX_NODES`, `ORDER_SEARCH_MAX_MS` in `ordering.ts`) stays incomplete.

## Team standings

`teamStandings` recognizes the spec29 layout only by panel regions and colors ([fixture](../../apps/web/tests/fixtures/spec29-teams/README.md)). Groups reference ordinals of `Capture.rows`, distinct from placements; group totals are readings of their own, and an empty reading stays unknown.

- `groupTotalAnswers` stores answers per group, apart from the read total. A mismatched sum only flags the conflict: choosing which number to correct takes other evidence; `consistentTeamRows` releases only groups with every number and a consistent sum.
- Lounge teams come from the bot list; an in-game group that diverges from it asks for clarification.
- Keeping the context leaves Races and valid numbers as they are; associating with an existing race only adds evidence.

## Reconciliation

`reconcileSequence` runs after writes. `Mogi.sequence` separates facts bound to sources (`numbers`, `origins`, `links`) from projections (`occurrences`, `relations`, `gaps`, `roomAnalysis`); an explicit fact prevails over a `deduced` projection.

- Occurrences and anchors: `complementarySourceGroups` and `boundaryCoordinates` (`boundary-coordinates.ts`), `raceNumberWithinCeiling` and `initialFactsFit` (`room-projection.ts`). Two sources of the same occurrence take a single race.
- The occurrence reuses `Race.id`; in a split, each part has a distinct ID. Complete results edited by the user are independent facts.
- `relations.completedSteps` measures the distance between cumulative boundaries, distinct from the count of valid numbers. A gap with `order: 'unknown'` has unknown order and count; physical count ≠ counted. Coverage and finish order require evidence beyond scalar totals.
- A race whose inferred number lost its support keeps a review until a numbered occurrence of the race, or a declared origin, supports it again; then the review clears and reconstruction runs (`reconcileSequence`). A projected race read only from its own screens follows them, as a fresh import would (`followOccurrenceNumbers`, `race-projection.ts`): it takes their current number, or goes back to context when they have none, so a mogi numbered by an older analysis heals on load and an answered number moves the race. The numbers it leaves are filled by new pending races (`pendingRacesThrough`), so each race keeps one number. A sequence conflict marks the races it projected with `sequenceConflictReview`; once reconciliation finds no conflict, the mark clears from every race it left pending and empty, so a removed image added again counts those races anew. Both reviews are stored and matched by text: rewording one adds its earlier text to `earlierReviews` (`origin-scope.ts`), which `reconcileSequence` maps to the current wording.
- `associations` and `projectedRaceIds` are retractable: they are cleared before the next analysis, so each conclusion rests only on facts. Correcting a source reopens only the dependent conclusions.
- Every answer is rechecked against the current state before it is written. The range query (Edit continuity, Edit counted races) is read-only; correcting is an explicit action and preserves an independent manual result.

Projections are recomputed on load. Accepting and learning the fallback IGN is one transaction. The game's final screen keeps the mogi open.

### Declared zero origin

A `zero-valid-12` declaration with a current signature supplies the zero boundary as a declared fact, apart from images and readings. It requires the same twelve represented players, native evidence, and absences, reopenings and discards compatible with it; validation starts only from the sources, excluding reconstructed outputs. Revoking or contradicting it withdraws the dependent numbering, coverage and reconstructions, preserving facts, originals and inactive history.

## Drafts and capture review

Races come only from interpreting images.

- `Mogi.raceDraft` keeps an edit outside `Mogi.races`, scoring, coverage and inference; opening it is read-only, and only confirmation applies it. Autosave writes only the draft (`withRaceDraft`, `lib/mogi/race-review.ts`), so Discard Draft leaves the race as it was. A valid edit uses the same `applyReviewedRace` as confirmation, and the validator receives the list **already projected**, so substitutes are projected only once.
- `Mogi.captureReview` is a single aggregate (format in [backup](backup.md#capture-review)). Pending OCR stays out of `Mogi.captures` and the standings; on resume, intake uses the durable original. Confirming applies the result, consumes only its file and advances the cursor in one transaction; a confirmed source stays confirmed even with late OCR.
- Autosave applies a functional update over the latest snapshot and checks the source's SHA-256 signature before confirming; CAS between windows stays active. Restoring keeps the draft out of the count, and images referenced by the batch are protected from removal by another control.
- Opening a mogi writes only `activeMogiId` (`saveActiveMogi`), a key beside the snapshot that loading reads over the snapshot's field; it still checks and advances the revision. Every snapshot write also writes the key.

### Older writers

CAS blocks stale snapshots; a semantically incompatible write from an old client (confirming an image while ignoring the batch, leaving the backup with a broken reference) needs another barrier. So a generation with an incompatible write bumps the IndexedDB version (currently 4, `lib/mogi/storage.ts`) while keeping the store, records and Blobs: opening at a lower version fails (`VersionError` → `UnsupportedTrackerVersionError`), the app closes the connection on `versionchange` and, when blocked by another window, refuses with "Close other app tabs and try again.". `TrackerState.version` stays 1.

The offline inventory marks the generation with `tracker-cas-capture-review-v1` (`writerProtocol`); the root reopens offline only in a generation with the same protocol ([offline](offline.md)). Against an old writer already open online, the barrier is the IndexedDB version; the marker covers offline reopening.
