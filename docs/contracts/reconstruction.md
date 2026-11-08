# Proven totals, corrections and reconstruction

Standings, text, the `!submit` command and PNG consume a single adjusted coverage projection (`coverageProjection`, `packages/engine/src/domain/reconstruction/coverage.ts`): each confirmed result adds its adjusted points ([scoring](scoring.md)) to the historical participation slot. An unknown total shows as unknown. Only what is determined, complete and free of conflict enters the totals.

## Coverage

- A participation total is proven only from race one onward; points after a gap show per race only.
- Uneven coverage across slots suppresses a comparable ranking and the unannotated command; text and PNG keep their actual scope. Competition ranks (5, 5, then 7) apply alike in UI, text and PNG.
- `resultCoverage.complete` requires twelve common adjusted valid races, with all coverage resolved and free of conflict. The mogi always stays open: actions, images and intervals keep it editable ([ADR 0003](../adr/0003-finished-mogi-without-closing.md)).
- A lone final of race 12 can prove all twelve totals with no questions (`provenIntervals: a lone race-12 final…` in `packages/engine/tests/needs-images.test.ts`); below 984 the room shrank and only race 12 counts.
- `mogiOverview` marks as `needs-images` the race that took place with no capture of its own, no open question and outside all coverage; only images resolve it. Cases in `needs-images.test.ts`.

### Proven intervals

`provenIntervals` (`coverage.ts`) establishes an interval's adjusted contribution without a per-race breakdown; each precondition is a named predicate there (`completeHistories`, `spanFitsSteps`, `subtractableDiscardedRace`, `stableParticipants`, `nativeTwelveGains`). Why it is this strict: only a native room of twelve fixes the Lounge adjustment, so smaller gains stay unproven until the representation is established, and a crop row count or an illegible IGN never proves an absence. Each person's cumulative stays in their own slot, including at a substitution boundary and with an unknown or restarted identity.

Two adjacent unknown races with different finish orders are symmetric between the same totals: `provenIntervals` covers the native-12 contribution; per-race detail waits for independent position answers.

Restoring a ZIP validates shape and references and recomputes the evidence from the sources.

### Selection and correction

- Contributions are disjoint: an interval that contains another counts once; a known inner result only adds detail.
- Partially overlapping intervals with no established intersection, and incompatible totals in the same interval, are explicit conflicts (`coverage.test.ts`).
- `detailContradictsInterval` suspends a proof as soon as independent detail makes it infeasible, before every inner race is known, so a wrong total never waits for the full breakdown. The proof keeps its history, and the independent results stay.
- `coverage.history` keeps every superseded proof, so a proof's `signature` is a SHA-256 digest of its inputs (`sha256Hex`), never the inputs themselves, computed only when `normalizeCoverage` stores the proof (totals read the contribution alone): the Tracker saves its whole state as one IndexedDB value, and Chrome rejects a value above ~127 MB. `normalizeCoverage` digests longer signatures stored by older versions and keeps one history entry per proof and signature.
- A current position fact constrains the covered occurrence once; fact history and deferred questions stay out of the totals.

## Physical identity and valid numbering

`Race.id` is the physical identity: changing validity (Don't Count This Race / Count Again) keeps captures, position facts, historical people, credit and native observations on the same race. `Race.physicalNumber` is an internal coordinate of a numbered timeline, relative to the earlier unknown gaps; `Race.number` is the current valid Lounge number, held only by counted races. The adapter reconciles in physical coordinates and then projects valid numbers; an inferred placeholder's coordinate is a projection, distinct from a manual fact.

- Number answers store the given number apart from the physical referent. `Substitution.fromRaceId` ties the entry to the physical race; `fromPhysicalNumber` and the legacy `fromRace` remain accepted.
- Compressing the valid numbering preserves the historical occupant; correcting an entry asks for participation review only where eligibility changed.
- A native interval of 12 keeps the raw delta, including discarded races, and subtracts only what `subtractableDiscardedRace` accepts (`physicalSteps`, `discardedRaceIds`); an unknown discarded race suspends the interval instead of subtracting a guess.

The serialized writer applies corrections over the latest aggregate, normalizes sequence/reconstruction/coverage, writes once and only then publishes; a failure keeps the last durable result. Physical metadata require ZIP3.

## Reconstruction

Two local, cancellable searches infer `reconstructed` results from the chronology and the current sources: the **exact** one ([`reconstructOne` and `exactBoundarySearch`](../../packages/engine/src/domain/reconstruction/reconstruction.ts), [`exactPlacementSearch`](../../packages/engine/src/domain/reconstruction/exact-placement.ts): one missing race between checked cumulative boundaries, with every other occurrence in the interval known; final standings are such a boundary, so final totals settle the last missing race) and the **assisted** one (`assistanceProblem` in `assistance-problem.ts` builds the equations, `solveAssistance` in `assistance.ts` searches several already-numbered gaps with the known positions). Cases in `reconstruction-contract.test.ts` and `assistance-contract.test.ts`.

### Invariants

- Equations use native values per real identity, session and span: Lounge totals and credited names stay out of continuity, and each substitute carries only their own cumulatives.
- The unknown stays unknown; an inferred absence requires compatible gains and continuity. A person without their own cumulative keeps every compatible room context.
- A twelve-person room's cumulative crop that misses exactly one row, with the other eleven legible and named, gives that person 82 per completed race minus the eleven totals: `unseenRowParticipant` ([room-boundary.ts](../../packages/engine/src/domain/sequence/room/room-boundary.ts)). The person must show in another capture with no absence on record up to that screen, since a row count never proves an absence; an absence in a later race leaves the earlier sum whole. With more missing, the totals stay unknown.
- `numberedRoomSpan` ([room-sequence.ts](../../packages/engine/src/domain/sequence/room/room-sequence.ts)) admits only spans fixed by numbered physical occurrences; pending breakdowns do not block search or interval proof. A high gain alone leaves the missing count unknown.
- A room shrinking inside a gap is numbered from the totals only when exactly one race count fits any mix of room sizes between the boundaries (`mixedRoomRaceCounts`, `per-person-vector.ts`). People back near zero in that comparison restarted: the rest decide the count while they are at least six and a majority (`restartsAside`), and every restarted total fits the races counted.
- Two solutions prove ambiguity; a single one is unique only after exhausting every context (12/11/10 represented, absences without order). A limit or cancellation yields an incomplete analysis, inconclusive as to uniqueness and existence.
- A unique solution enters automatically; ambiguity, conflict and incomplete analyses stay pending in the race detail and resolve only with new evidence. Each group applies whole, at once.
- [`stableParticipantPath`](../../packages/engine/src/domain/sequence/participant-continuity.ts) preserves a checked direct comparison through an unsettled screen. Separate vector groups without a reopening do not establish a reset (`roomReopeningBetween`); `initialSegmentsContinue` checks their per-person totals. An established restart still blocks continuity.
- Reconstruction stays out of anchors, out of the contributions to another reconstruction and out of the premises of its own proof. The result holds under the checked hypotheses, including that the OCR is right.
- The search budgets are the named constants at the top of `exact-placement.ts`, `assistance-problem.ts` and `assistance.ts`; they keep a phone responsive, so resolving many gaps carries no guarantee.

### Revalidation

The proof stores only its inputs and their SHA-256 signature; the reconstructed output and the credited name stay out. Every proof, history entry and assisted analysis is kept in the same single IndexedDB value as `coverage.history`, so each stored signature, including a boundary check's, is a digest; `compactReconstructions` (`reconstruction-storage.ts`) digests the raw signatures older versions stored, leaving the proof current. Every entry point to the Tracker state (write, load, restore preview, totals, export) recomputes the single proof (`normalizeReconstructions`, `normalizeAssistance`); a restored status yields to the recomputed proof. Correcting evidence, a number, an association, an absence, a position fact or a participation revokes the dependent results before standings and export, keeps the previous conclusion in history and reopens the mogi for review. Editing a reconstructed result makes it manual and archives the proof. A result screen whose finish order is accepted later replaces a reconstructed result of its race, even one built on position answers, since the reconstruction only fit the totals (`acceptFinishOrders`, `race-projection.ts`); reconciliation on load heals saved mogis the same way. A confirmed observed race lists the screenshots its occurrence holds: `withOccurrenceScreenshots` (`sequence-projection.ts`) gives back, on every normalization, those no other race lists, so saved mogis whose finish order screens lost their link heal without changing a result. A result confirmed from a screenshot always lists it (`applyReviewedRace`), whichever answer confirms it. A race names an assisted group only while it is one of that group's reconstructed targets: `settleAssistedRaces` (`assistance.ts`) drops a stale group id, on every normalization and whenever a new analysis replaces the targets, and a race left without a result goes back to pending so its gap is solved again. Images never overwrite a manual result; Revert to Screenshots ([Edit Result](experience.md#edit-result)) withdraws it, absences included (`withdrawManualResult`), and the next normalization reads or reconstructs the race afresh.

IndexedDB and ZIP store proofs, histories and images; the ZIP validates proofs and sources before the preview, and a removed capture becomes a tombstone. The changes are additive in snapshot version 1; older app versions reject the `reconstructed` origin, and data without these metadata stay readable.

### Position questions

Known-position questions live only in the queue ([mogi experience](experience.md)); confirming writes the fact with `changePositionFact` (`known-positions.ts`) and reruns the search. `usefulQuestion` picks the question that best splits the stored example hypotheses; when the joint search keeps no examples to split (its work limit), the earliest pending race whose own exact search kept two or more asks instead, even with a complete column read, since what still competes there is an absence or a restart; [`positionQuestionGainVaries`](../../packages/engine/src/domain/reconstruction/known-positions.ts) breaks ties toward unresolved native points. It stays a suggestion. A fact marked unknown leaves the math and stays in history; changing an occurrence's participant requires correcting the fact explicitly.

When a person's own cumulative is missing on both sides of a gap, or visible only before it, `positionQuestionGainVaries` asks about their place or absence if room contexts differ only by that person. In the one-sided case, eleven shared gains that fit only the native-12 scale and leave one value reconstruct the missing place uniquely. The answer, never an assumption, decides between room contexts. Until answered, the race stays in `questions`, not `needs-images`.
