# Mogi on Rails

Vocabulary for tracking Mario Kart World Lounge 12p mogis.

## Language

**Mogi**:
Lounge match with 12 players, planned for 12 counted races, with individual results and, depending on the format, team results.

**Race**:
Single stage of a mogi, with its own result, counted or discarded.

**Counted race**:
Race included in the mogi's individual and team totals.

**Unseen race**:
Race that took place, inferred from later evidence, whose individual result is unknown. Its points may be inside a proven total.
_UI_: "Not seen"

**Pending race**:
Race with a known place in the mogi's sequence and a result still to be established.

**Result gap**:
Stretch between observed results where results of races that took place are missing; how many are missing and where may be unknown.

**Discarded race**:
Race that took place whose points stay out of the Lounge totals; its result can serve as evidence of the game cumulatives.

**Race number**:
Place of a race in the sequence of the 12 planned for counting. Only counted races take a place.

**Track**:
Course on which a race is run.

**Race value**:
Your average place in that mogi minus your place in the race, on a track: the positions you gained against your own level that night. It compares across FFA, 2v2 and 3v3 because it uses places, not points, and controls for room strength and tier. The mogi average uses every race you placed in, with or without a track.

**Recent window**:
Your last 36 mogis (`RECENT_MOGIS`) by start time, among those with your Lounge name. Every counted race on a track in them counts; races from older mogis are listed but not counted.

**Plus / minus**:
A race value above zero is a plus race (positions gained), below zero a minus race (positions lost); zero is neither. "+/−" counts every race.
_Avoid_: Gains, Losses, Lost

**Typical +/−**:
How a track goes for you now: the median race value in the recent window, so a single crash or disconnect leaves it in place. Typical plus and typical minus are the medians of the plus and of the minus races only (`typicalPlus`, `typicalMinus`), none when the track has no race on that side.
_Avoid_: Typical race, Track value, Track score, Win rate

**Usual range**:
The 1st to 3rd quartile of a track's race values in the recent window (linear interpolation, type 7). Worst / best are the window's lowest and highest race values.

**Frequency**:
How often a track comes up: how many of its races are in the [recent window](#recent-window).

**Total +/−**:
The sum of a track's race values in the recent window (`cost` in the engine): what the track adds to or takes from your finishes overall. Total plus and total minus sum the plus and the minus races only (`totalPlus`, `totalMinus`), none when the track has no race on that side.
_Avoid_: Contribution, Cost, Priority, Positions lost

**Vote light**:
A track's call for voting, from its [usual range](#usual-range): Good when the 1st quartile is above zero, Bad when the 3rd quartile is below zero, Mixed otherwise, including a track with fewer than 3 races in the recent window (`voteLight`).
_Avoid_: Rating, Grade, Tier

**Unstable track**:
A track with at least 3 races in the recent window whose usual range reaches 2 positions on each side of zero (1st quartile ≤ −2 and 3rd quartile ≥ +2, `UNSTABLE_REACH`), so Typical +/− hides good and bad races alike, as on a track that splits into two clusters.

**Capture**:
Screenshot of a game screen used as evidence of a race. Several captures can refer to the same race.
_UI_: "screenshot"
_Avoid_: Image, Photo, Race

**Source**:
The capture a reading, answer, fact or result rests on. It names the role a capture plays for one conclusion, so one capture is the source of many conclusions and one result can have several sources.
_UI_: "screenshot"
_Avoid_: Origin, Evidence image

**Occurrence**:
One race that took place, as the capture sequence places it: the captures showing that race, grouped, at its position among every race played in the room. It exists before its race number or result is known; a discarded race has one too.
_UI_: "race"
_Avoid_: Instance, Physical race

**Photo moment**:
Instant a capture was created, according to the best available source; may be unknown. Sources in the [sequence contract](docs/contracts/capture-sequence.md#photo-moment).

**Finish-order screen**:
Game screen with the players in the finish order of a race, which may show race points and game cumulatives.

**Overall standings screen**:
Game screen with the players sorted by game cumulative, which may differ from the placement in the last race.

**Two columns (twoColumns)**:
Pre-race capture with individual cumulatives not grouped by team and the track to be raced. The players' layout is independent of the race standings.

**Two columns, by team (twoColumnsByTeam)**:
Pre-race capture with individual cumulatives grouped by team and the track to be raced. Groups exist, optionally, only in 3v3. Without them, including in every 2v2, the screen is Two columns and the team is recognized by its tag.

**Finish order, adding points (finishOrderAdding)**:
Post-race capture in finish order, with the point additions visible; the cumulatives may be before the sum or mid-animation.

**Finish order, points added (finishOrderAdded)**:
Post-race capture with the final cumulatives, already including that race, still in finish order.

**Overall standings (overallStandings)**:
Post-race capture with the final cumulatives, re-sorted by the in-game event's overall standings.

**Team standings (teamStandings)**:
Post-race capture with the players grouped by team, individual cumulatives and team totals.

**Final standings (finalStandings)**:
Capture of the in-game event's closing screen, with final overall standings and individual cumulatives. The mogi finishes by its counted races, regardless of when that event ends.

**Pending batch**:
Screenshots selected or received, kept for review before confirmation. The batch order is independent of the race sequence, and its screenshots become results only after confirmation.

**Capture review**:
Review of the pending batch, one capture at a time; confirming applies its result and consumes only its file.

**Draft**:
Race edit kept outside the mogi's races, scoring, coverage and inference; only confirmation applies it.

**Recognition**:
Reading of a capture: names, positions, numbers, screen type and uncertainties.

**Reading**:
One value read by recognition (text, value, confidence, alternatives), kept apart from its corrections.

**Capture analysis**:
Matching a set of captures against the known facts to relate sources, sequence, gaps, totals and determined or pending results.

**Lounge name**:
Name that identifies a participant in the Lounge and in the mogi's roster.
_Avoid_: In-game name

**Your Lounge name**:
A Lounge name of the person using the app, set in Settings. There can be several, since a Lounge name can change, and each counts as you. None is set until the person confirms one; the Lounge name present in every mogi (`defaultLoungeName`) is only a suggestion. Tracks counts only races where one of them is a participant.

**Synonym**:
Recognition spelling the user confirmed as belonging to a participant, used to recognize them in later captures.
_Avoid_: In-game name

**In-game name (IGN)**:
Name shown for a player on the game's screens; may differ from the Lounge name.
_Avoid_: Lounge name

**Format**:
Split of a mogi's 12 players into individual competitors (FFA) or teams of 2 (2v2) or 3 (3v3), as in the Lounge's normal queue.

**Team**:
Group of players in 2v2 or 3v3, fixed by the bot list; in game it is recognized by its tag.

**Roster**:
A mogi's players, identified by Lounge names and grouped by format.
_Avoid_: Standings

**Participation**:
One of the twelve slots of the roster; with a substitution, its total can combine points from different players.

**Participation span**:
Period during which a player holds a participation, from their entry to the entry of any substitute.

**Substitution**:
Another player taking a participant's place from a defined race of the mogi onward.

**Credited player**:
Participant whose Lounge name receives the total in the exported result when there was a substitution; that assignment is the credit.

**Race result**:
Placements and points of the players in a specific race.
_Avoid_: Mogi result

**Reconstructed result**:
Race result inferred from other evidence, without a complete capture of that race; its origin is kept distinct from a result observed on screen.

**Reconstruction hypothesis**:
Possible combination of results for the missing races, compatible with the evidence and the available knowledge. Different hypotheses can have the same cumulatives.

**Known position**:
A player's placement or absence in a specific race, given by the user to narrow the reconstruction hypotheses.

**Assisted reconstruction**:
Inference of results that combines the evidence with known placements given by the user to narrow the hypotheses.

**Clarification question**:
Request for a known fact that can reduce an uncertainty of reading, association, sequence or result. Only the answer supplies the fact; until then, the hypothesis stays a hypothesis.

**Question queue**:
The single set of a mogi's open clarification questions, whatever the uncertainty of each.

**Disconnect (DC)**:
A player losing connection to the room. Their CPU may continue the race and appear in the result under that player's name.

**Absent**:
Participant missing from the race result, both in person and as a CPU.
_Avoid_: Unrecognized name

**Room**:
The in-game session in which a mogi's races are played; its room size is the number of players represented in a race.

**Scale**:
Points per placement for a given number of represented players: the Lounge scale of 12, or the native scale for 12, 11 or 10.

**Native points**:
Points the game awards a player in a race, by the scale for the room size.
_UI_: "in-game points"

**Game cumulative**:
Point total the game shows for a person in the room. Includes races discarded from the Lounge and may restart after leaving, returning or a room reopening.
_UI_: "game total"
_Avoid_: Partial result

**Room reopening**:
Recreation of the in-game room during a mogi, which restarts the game cumulatives. The mogi and its points stay the same.

**Continuity segment**:
Sequence of races in which the same person's cumulatives belong to the same room session, bounded by room reopenings and individual restarts.
_Avoid_: Participation span

**Per-person vector**:
The cumulatives of each person in a capture, compared across captures to place them in sequence.

**Anchor**:
Confirmed final-step cumulatives that sequence and reconstruction must respect; reconstructed results never anchor.

**Declared zero origin**:
User declaration that the twelve started the room at zero, supplying that starting boundary as a declared fact apart from captures and readings.

**Adjusted race points**:
Points counted for the Lounge after adjusting the race to 12-player scoring and handling the absent.

**Proven total**:
Total of a participation's adjusted points determined by the evidence, with or without a per-race breakdown.

**Proven interval**:
Range of races whose adjusted contribution to each participation is established without a per-race breakdown.

**Coverage**:
The races and proven intervals whose adjusted points enter a participation's total; uneven coverage across participations suppresses a comparable ranking.

**Pending breakdown**:
State in which the totals of a range of races are proven and their per-race breakdown remains unknown. On its own, it is compatible with a complete partial or final result.

**Partial result**:
Standings and totals of the players and, if any, the teams of a mogi in progress, determined by the available race results and proven totals. Identifies the races and ranges covered and counts each point once.
_Avoid_: Final result

**Incomplete partial result**:
Partial result missing results of races already run that should be counted; identifies the included and the pending races.

**Final result**:
Standings and totals of the players and, if any, the teams at the end of the mogi.
_Avoid_: Partial result

**Finished mogi**:
Mogi with its 12 counted races established. While any is missing, it stays in progress; discarding one of them returns it to in progress.
_Avoid_: Ended mogi, Closed mogi

**Glance**:
The 20 to 30 second look at the mogi screen between races that answers "how is the mogi going?" and "do I need to do anything?".
