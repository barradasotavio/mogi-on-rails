# Scoring and export

`Race.placements` stores only the represented placements. `absentParticipantIds` is a set, with no order among the absent. The IDs belong to whoever played the occurrence.

## Adjusted points

Represented players receive the Lounge scale of 12 at the observed placement and each confirmed absent player receives 1 (`pointsFor`, `packages/engine/src/domain/scoring/points.ts`). So the mogi's sum varies with the represented players: 82 for 12 and 11, 81 for 10 (`scales-contract.test.ts`). A visible CPU is represented by its placement. Low confidence or an illegible name stays an uncertainty to resolve, separate from DC.

## Native points

`nativePoints` stores the native points, always modeled from the scale of the represented count; nobody types them. They are distinct from adjusted points and from cumulatives. Scales in `nativePlacementPoints` (`packages/engine/src/domain/scoring/native-points.ts`):

| Represented | Native scale | Sum | Adjustment for those present |
| --- | --- | --- | --- |
| 12 | 15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 | 82 | — |
| 11 | 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 | 67 | +3/+2/+1 |
| 10 | 11, 9, 8, 7, 6, 5, 4, 3, 2, 1 | 56 | +4/+3/+2 |

The scales for 11 and 10 came from the user's rules, and the panel states that origin. The scale for 11 has visual corroboration on the game screen in the LT's `img/docs/5-edit-race.jpg` (commit pinned in `THIRD_PARTY_NOTICES.md`); the scale for 10 rests only on the user's rules. If a real screen contradicts a scale, the fix is to change `nativePlacementPoints`, never a per-race value: once the count is known the scale is fixed, and a hand-typed value could only make it wrong and break the chaining of game totals. Lounge points follow the finish order, and absent players have no native value.

Saved data from older versions may carry `nativePointOrigins: "manual"`. Loading re-models those races from the scale (`withModeledNativePoints`, run first in `normalizeReconstructions`); history snapshots keep the old values as read-only history. Nothing changes silently: Lounge points never read native values, and a proof that depended on the old value fails its input signature and is revoked for review ([reconstruction](reconstruction.md)).

## `!submit` command

PNG, text and command are generated locally, and the user takes them to Discord; the app stays disconnected from the bot. `loungeSubmission(mogi)` generates the command only when `resultCoverage(mogi).final`; otherwise it returns the structured blockers. A proven total releases the final result even with a pending breakdown.

The format is that of `formatResults`, the normal queue's default mode, from the [adapted LT](https://github.com/PFQNiet/mkw-lounge-tracker/blob/4f0bce33404c734b6d3125b9e3ee4ac9da28d434/src/ui/export-results-dialog.js) (recorded in `THIRD_PARTY_NOTICES.md`):

- First line `!submit <players per team> <tier>`: 1 FFA, 2 2v2, 3 3v3.
- One line `<credited Lounge name> <points>` per participation, in roster order.
- In 2v2 and 3v3, a blank line separates the teams; the text ends at the last character of the last points line.
- Default mode only: SQ mode, `Team N - TAG` tags, `[]` and the War command stay out.

`packages/engine/tests/fixtures/lt-submissions.json` stores the outputs of the original `formatResults` (URL, commit and SHA-256 of the source), compared in `submission.test.ts`. This proves the LT contract; acceptance by the current bot remains to be verified.

Blockers appear one per line, in this order: awaited races, unknown totals, pending credit (one line per participation) and open questions (except credit questions, already listed); texts in [copy.md](copy.md#reference-copy). With blockers, copying is unavailable.

## Credit

With a substitution, the credited name receives the participation's total; the historical evidence keeps who played each span. `creditSuggestion` (`packages/engine/src/domain/scoring/credit.ts`) suggests without writing, by Lounge rule 6.4 (6.d in the LT): the last substitute who held the slot from race one or played `MIN_WINNING_RACES` counted races in a winning position; otherwise (including 6.e), the original. Discards stay out of the count of races played. Cases in `credit.test.ts`.

The suggestion is `null` while the twelve races, the comparable totals or the team split are missing; credit blocks the final result, but asks only afterwards. In the queue, it comes after the capture questions; confirming writes `creditedParticipantIds`. Changing results preserves the answer; changing a substitution via `requireParticipationReview` invalidates only that participation's credit.
