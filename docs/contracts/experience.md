# Mogi experience

The mogi screen serves a 20-to-30-second **glance** between races: it answers "how is the mogi going?" and "do I need to do anything?"; everything else is one tap away, in a sheet. Applies to the mogi screen, its sheets, the mogi list, [Tracks](#tracks-screen), [Instructions](#instructions) and [Release Notes](#release-notes). Components and surfaces: [design system](design-system.md); exact copy and capitalization: [copy.md](copy.md) (English interface, [ADR 0002](../adr/0002-english-interface-and-documentation.md)); the why: [HIG and Liquid Glass research](../research/hig-liquid-glass.md).

## Principles

1. **Silence when everything is right.** A confirmed result is number, points and track. Source, coverage, file name and diagnostics live in the race detail or in Images.
2. **One action in the header**, the one that matters now ([precedence](#header-action)). Each action appears in one place only: header or bar.
3. **One question at a time**, in the [question queue](#question-queue) ([ADR 0004](../adr/0004-single-question-queue.md)), with the most likely suggestion preselected when there is evidence. Doubts appear only in the queue.
4. **The layout holds still.** New content enters a reserved place: 12 slots in the grid and 12 player rows from creation; reading progress takes the place of the header action. Arrangements come only from CSS and container queries, from first paint.
5. **Controls in glass, content opaque.** Detail, task and menu are sheets over the mogi ([ADR 0005](../adr/0005-adaptive-surfaces.md)); the mogi screen stays underneath.
6. **Self-explanatory.** Options and data explain themselves through labels, trailing values and column headings, with no footers ([copy](copy.md#self-explanatory)). Rules players need live in [Instructions](#instructions).

## Structure

Top to bottom (`components/mogi-overview.tsx`; grid states in `mogiOverview`, `packages/engine/src/domain/mogi/mogi-overview.ts`):

- **Header** (both size classes): the mogi's title; under it, format and progress ("Race N of 12", "No races yet" before the first race, or "Finished") and, from the first counted race, who leads and by how much; on the right, the header action. The toolbar holds no title and no copy actions.
- **Races**: the 12 race tiles under that section title. Available tiles open the race or the queue.
  - Portrait tiles (2:3). In a container narrower than 48rem, one row that scrolls sideways past the page gutters, 56px tiles, kept centred on the race being read or else the last counted one; from 48rem, 12 across filling the width, so a tile is never smaller than on a phone (`race-grid`, `app/globals.css`).
  - Tiles are content, so no glass: a soft fill with a light sheen from the top and larger continuous corners (`race-tile`), in the spirit of the Shortcuts tiles. Inside, a road in perspective that scales with the tile and fades toward the horizon. State colours keep their meaning below; each glyph keeps at least the contrast it had on a flat fill, in light and dark.
  - **Reading**: the road goes by; no number and no finish line yet.
  - **Counted**: the finish line, a slight arc of checks, at the top; the number under it; the road still. When a race counts on screen, the road brakes from where it was, the finish line arrives and the tile pops; with reduced motion, only the state changes.
  - **Unseen**: the app only knows the race happened (its points may be inside a proven total). Looks like a future race, inert to taps.
  - **With questions**: "?" in place of the number; a tap opens the queue.
  - **Needs screenshots**: the engine knows the race happened, but lacks the evidence to count it or to ask a useful question (e.g. fewer than 12 players before a single final capture). Neutral color, because it is a normal state (red and orange mean error); a dashed outline and a ghost set it apart from future and from "?". A tap opens the race's sheet, subtitled "Needs screenshots", with the projection's reason when screenshots of later races can't help, Add Screenshots, which closes the sheet and opens image input, and Enter Result, which opens [Edit Result](#edit-result) with every place empty. A race whose only screenshot wasn't recognized after its number was answered also needs images. Images resolve it; the one exception is a race no image can ever prove (a disconnect at its end, a reopening after it), whose result the maintainer types by hand. The row in Tracks and the table column open the same sheet.
- **Vote**: which tracks to vote for, as one wrapping row of track symbols, each with its [vote light](../../GLOSSARY.md) as a dot inset in its bottom-right corner: Good, then Mixed, then Bad, each by Typical +/−, best first (`voteTracks`, `lib/track-order.ts`). Each symbol's accessible name carries its light's word, so colour is never the only cue; there is no legend. Only tracks with a race in the recent window, and nothing without them or while Tracks › Sort › Show Vote on Mogis is off (`voteShown`, in the state and the backup; on by default). A track raced in this mogi, chosen or recognized (`raceTrack`), a Don't Count race included, stays in its place, struck through. Static; computed in `components/tracker.tsx` from every mogi.
- **Standings** and **Tracks** side by side from a 45rem container, stacked below it; the table below them.
- **Standings**: teams in a team mogi, players in FFA, never both. A row: rank; for a team, its name over every player from top scorer down, each with points and movement since the race before (a dash when the rank held); for a player, the name and movement. At the end, the points race by race as bars (`RaceBars`) in the team's or player's colour, the gap to the rival just ahead (none for the leader) and the total. A team row is as many Tracks rows tall as the team has players (twelve divided by the number of teams), so their dividers meet. A row opens that team or player alone in Players, which then just closes.
- **Tracks**: one row per race with its track, or "Log Track" while it has none, and a crown badge with the race's winning team or player. A row does exactly what its race's [table column](#table-and-image) does, through one handler (`raceShortcut`): questions open the questions, a race needing images or still pending does what its tile does, and a resolved race opens its track picker. Unseen races open the detail for advanced editing; while one exists, the list stays reachable in a wide container too. In a wide container, the full table appears.
- **Discarded**: only when there is one.

## Header action

A pure engine function (`mogiOverview` › `action`); the interface only renders it, in the header on both size classes, one place, by precedence: reading in progress (a status instead of a button; polite announcement) › questions (opens the queue) › Copy !submit on the final result › Copy Table with at least one counted race › nothing.

## Question queue

Generated by `mogiQuestions` (`packages/engine/src/domain/questions/mogi-questions.ts`) and presented by `components/question-sheet.tsx`. Name-matching algorithm: [OCR › Names and associations](ocr.md#names-and-associations).

**Order and state**

- Derived from state: answering saves the fact and recomputes the next question; deferring ("Not Sure") is session-only state, kept out of the save, and sends the question to the end.
- Every question of the mogi (name, unreadable points, race of a capture, team, known position, credit) in one queue, ordered by `questionOrder`; within a race, name questions are ranked by `nameClarity` (`packages/engine/src/domain/questions/mogi-questions.ts`).
- Each ID is one page, even when several projections generate it; the header counter counts effective answers. The sheet title adds those confirmed in the session to the current queue, so the total grows with new questions.
- The race suggestion respects the per-person vector, the anchors and the reopening rules of the [sequence contract](capture-sequence.md), including in a gap before the last proven anchor.
- Names: one question per pending spelling across captures with the same eligible participants; the first occurrence stands for the rest, and a line under the reading cites the other races or images. On answering, a capture where the chosen player already holds another row keeps its question. A spelling repeated within one capture asks for one answer per row.

**Sheet**

- Crop at the top when there is one: a race question shows the whole capture; name, points and team show the row. A question with two captures (continuity) stacks them in chronological order, each labeled as in Images; two equal labels show once. A position question stacks, the same way, the race's results screen, otherwise the totals just before and after the race (`positionShots`, `lib/mogi/position-shots.ts`): each shows the person's row when linked, the whole screenshot otherwise; a race with neither shows none. Tapping a crop opens the [viewer](#capture-viewer).
- Choices preselect "Suggested" only with evidence; without it, Confirm stays disabled until a choice is made. Points come prefilled with the suggestion.
- Answering the last question closes the sheet; if the last one was deferred, a toast says so. After Confirm, the sheet scrolls back to the top.

**Answers**

- They reuse `sequence.numbers`, `numericAnswers`, the participation's still-undefined `teamId` and `assistance.facts`; original OCR, persistence formats and backup fields stay as they are.
- Teams from the bot list stay fixed. The queue can fill a missing `teamId` from `teamChoices` (`packages/engine/src/domain/questions/mogi-questions.ts`). The ZIP accepts this incompleteness and rejects unknown IDs, the wrong number of teams and teams above the format's size.
- Saying who a spelling is creates a synonym for the whole mogi ([spellings](capture-sequence.md#spellings)). Strong matches go in directly; in Players, "Read as X" and "Unlink" check and correct them. Unlinking returns the deduction to the queue, and accepting it again takes a human answer or new evidence. Typing a player's in-game name says who that spelling is in every capture (`changeIgn`). Substitution is the last resort.

## Controls

| Where | Controls |
| --- | --- |
| compact, mogi list | Settings (left) and New Mogi (`tint`, right) float at the bottom, loose over the content; the list is the root and needs no Back |
| compact, Tracks | Back (left) and Sort (right) float at the bottom |
| compact, Instructions | Back floats at the bottom |
| compact, mogi | group Back · Menu (· Undo); Add Screenshots (`tint`, circular) on the right. Menu opens Table, Players and Mogi Settings |
| regular | toolbar across the content column: Show Mogis (while the sidebar is closed or floating) on the leading side; on the trailing side (Undo ·) Table (only while the table exceeds the screen) · Players · Mogi Settings, then Add Screenshots (`tint`). Labels collapse to symbols as width runs out; then Table, Players and Mogi Settings move into More (…), the Menu sheet. The header action stays in the [header](#header-action) |

- **Settings** (`menu` presentation): Your Lounge Names ([Tracks](#tracks-screen)), Appearance, [Watched Folders](#watched-folders), Storage; under them, "Update ready" with Restart Now while an update waits. Settings holds settings and actions only; guidance on how to use the app lives in [Instructions](#instructions), and the licenses ship under `/licenses` and `/ocr`, linked from its footer.
- **Screenshots**: Add Screenshots stays after the mogi finishes: a late screenshot still fills tracks and adds evidence, and what is proven changes only on a conflict. On regular, dragging images over the mogi adds them; pasting (⌘V / Ctrl V) works in both size classes. Every image taken in is read and ends saved or failed, never waiting. Images stay in the mogi they entered: one already stored is left out, and the toast names where it is; one in another mogi joins this one once removed there (Remove Image, Delete Screenshots or Delete Mogi).
- **Paste confirms first** (`components/captures/pasted-screenshots.tsx`): the clipboard may hold a stale or unrelated image, so a paste opens the Pasted Screenshot sheet instead of adding it. It shows every pasted image (several in one sheet), each opening the [viewer](#capture-viewer). Add to Mogi sends them through the same intake as Add Screenshots; Cancel stores nothing. An image byte-identical to one already stored (intake's own fingerprint check) says where it is and is not offered; with nothing new, the sheet has no Add to Mogi. Add Screenshots and dragging add at once.
- <a id="watched-folders"></a>**Watched Folders** (`components/app/watched-folders.tsx`, `lib/images/watched-folders.ts`): folders on the computer (an NSO Album Sync folder, a Downloads subfolder an automation moves AirDrop images into) whose new screenshots the app offers. The row exists only where `showDirectoryPicker` does (Chrome or Edge on a computer); elsewhere Settings has no row and no explanation. Add Folder opens the browser's read-only picker; Chrome refuses Downloads, Desktop, Documents and the home folder itself, and a refusal it reports appears inline, leaving the list unchanged. Each folder has Remove; a folder the browser stopped allowing says "Access needed", and Allow Access asks again. Add Without Asking, a switch shown once a folder is watched, off by default and one choice for every folder, skips the confirmation (below). The handles, the files already offered and that choice live in their own IndexedDB database on this device, outside the state and the [backup](backup.md).
  - **When**: only with a mogi in progress open on screen, the page visible and no sheet or dialog open: at once, on every `FileSystemObserver` change where it exists, and every 3 s.
  - **What**: a PNG, JPEG or WebP file (by name) dated at or after the mogi's `createdAt`, never offered before (name, size and date, per folder). Other files are left after their name and date. A file waits until two checks see it non-empty and unchanged, and the offer waits until every candidate has settled, so a sync in progress arrives as one batch. At most 32 per offer.
  - **Confirm**: the batch opens the same sheet as a paste, titled New Screenshot. Add to Mogi and Cancel behave as for a paste, and either way those files are not offered again. A batch made only of images already stored is marked offered with no sheet. With Add Without Asking on, a batch with something new skips the sheet too: it goes to intake as Add to Mogi sends it and is marked offered, or waits for the next check while intake is saving. A paste still asks, since the clipboard may hold a stale image. Folder images keep their own photo time (`pasted` never applies). The app never moves, renames or deletes a file.
- **Undo**: exists only while the image removal just made can be reverted, in the mogi it happened in. It notifies only through a polite announcement. It restores the image and the results it supported; ⌘Z / Ctrl Z does the same. It disappears for good on the next save (including Undo's own) and on leaving the mogi. Adding the removed image again reads it afresh instead of refusing it as a repeat; Undo then only releases the hold.
- Paste and ⌘Z work only with no sheet or dialog open and with focus outside text fields.

## Tracks screen

How each track goes for you, to choose which to vote for and which to practice, from data only this app has: the track and your finish in every counted race. Terms ([race value](../../GLOSSARY.md), recent window, plus / minus, typical +/−, usual range, total +/−, unstable track, Your Lounge name) are in the glossary; words in [copy.md](copy.md#reference-copy); charts and Sort in the [design system](design-system.md). Lounge data, MMR and format analysis stay out.

- **Destination**: the row under Release Notes at the top of the mogi list and the sidebar, above the mogis, at `/?view=tracks`. It opens like a mogi (pushed from the list, replacing from the sidebar), and Back returns to the list.
- **Who you are**: Settings › Your Lounge Names, saved in the state and the backup. Only races where one of those names is a participant count; several names cover a Lounge name that changed.
- **Header**: the title and the counts of the window, plus the window note only when older mogis exist. The list's section title names the measure, so the header explains nothing else. Sort is the one control: in the toolbar on regular, beside Back in the floating bar on compact; it appears once there is a track.
- **List**: one list of every track with a race in the window, every track alike whatever its race count. Sort chooses a measure (Typical, Total or Races) and, except for Races, which races it counts (plus/minus, plus only or minus only). A choice lasts for the visit; Make Default saves it as the **default track order** (`trackOrder` in the state and the backup; `lib/track-order.ts`), which Tracks opens in. With none saved, it is Typical +/−. The list starts at the extreme the measure is about: highest first for plus and +/−, most negative first for minus, most races first for Races; tracks with no race on the chosen side follow, with "—". The sign's colour says plus or minus. The Unstable badge marks unstable tracks.
- **Row** (`ListRow` with a chevron, as in Standings, since it opens a sheet): the 44px track symbol as leading artwork; the chosen measure is the main number, named once by the section title; the second line holds the race count, except when the measure is Races. Compact: the name and badge, the name truncating as elsewhere; under it the race count leading and the race bars and main number trailing, so the numbers line up down the list. Regular: the same name line over the race count, with the race bars and main number in the trail.
- **Track sheet** (`detail`): the six measures as a 2×3 grid (rows Typical and Total, columns +/−, Plus and Minus; a grid kept the sheet short where two grouped lists took eight rows); Usual range and Worst / best follow in the same list, so the group title "Positions" names their unit once; then Counted, which counts the window and the track's older races once there are any, with the window note; "Over time", to show improvement after practice; the window's races, newest first, titled as the mogi header (`mogiTitle`), with date, format, race number, your place, points and value, then the older races, not counted.
- **Empty states**, one at a time, each naming what's missing: no mogis; no Lounge name set (Set Lounge Name opens the setting, which offers the name in every mogi); no mogi with any of your names (Change Lounge Name); no counted race of yours with a track.

## Instructions

The app's workflows in the order of a mogi, and the landing page of someone with no mogis. A Help page by choice: no onboarding, no contextual tips. It is help, manual and landing at once, so every step leads with what the app does for the player, then says how and where. `components/instructions-screen.tsx`; words in [copy.md](copy.md#reference-copy).

- **Destination**: the first row of the mogi list and the sidebar, above Release Notes, always shown, at `/?view=instructions`, a link that can be shared. It opens like Tracks. Its toolbar holds Show Mogis and, as on the list, New Mogi while the sidebar is closed.
- **Landing**: opening with no mogis at all lands here (see [Regular navigation](#regular-navigation)). The page holds no actions of its own: New Mogi stays in the toolbar or sidebar, and the empty state behind it keeps New Mogi and Restore from Backup.
- **Page**: one scrolling page, a landing first and a manual after, its content at most `max-w-5xl` and every paragraph at most `max-w-prose`, spaced as a long page (`page-stack`; [design system](design-system.md#controls-and-lists)). In order:
  - **Hero**: the app's name as a small label (the `h1`), a benefit headline and one line on how, with no drawing.
  - **Proof points**: three claims, each with a symbol and a muted line of proof, on the page with no card (the steps are the cards), three across on regular.
  - **How it works**: the main path in six steps (start a mogi, take a screenshot, send it to your device, add it, answer, submit), as a bento of muted cards: one column, two equal columns from a 36rem list, and from 54rem three columns where each row pairs a narrow card with a wide one, alternating sides (steps 2, 3 and 6 wide). Every card hangs its tinted number, title and text from the top-left corner and sets its drawing in the bottom-right corner at the same 24px inset, so a row's numbers share a line and so do its drawings; a narrow card stacks the drawing under the text, a wide one sets it beside. Each step opens with its benefit in bold, then says how; keyboard shortcuts use `Kbd` ("Ctrl V / ⌘ V"); its drawing shows where.
  - **Get more out of it**: fixing races and names (missing races, results, subs and names), analyzing your tracks and keeping your data, each a symbol, a title and one description, with titles parallel (verb and object). Only what helps a first-time player get a mogi tallied belongs here.
  - **Install the app**: shaped like "Get more out of it": this system as a symbol, a title and its steps in one sentence, opening with why in bold (opens offline, safer), and Install App under it where the browser offers its own prompt; the other systems, steps only, under "Other devices" (iPhone and iPad, Android, Mac with Safari, Chrome or Edge on a computer).
  - **Licenses**: a muted "Open-source licenses" link to `/licenses/third-party-notices.txt`, the app's only path to them.

  Features and install systems are spaced as sections (`section-stack`), with no dividers, and every group title sits the standard title gap (`--section-title-gap`) above its content.
- **Pictures**: never a real screenshot. The game and the Nintendo Switch App are playful drawings that evoke them, with no Nintendo logos, characters or fonts; this app is drawn with its own components, in their real states, and sample data. Both sit in an `IllustrationStage` ([design system](design-system.md#controls-and-lists)), static, hidden from assistive technology and inert. Every step of "How it works" has one; the other groups show the symbol of what they name.
- **Upkeep**: a change to a workflow described here updates the page in the same change.

## Release Notes

What changed in the app, so players see it is maintained and bugs get fixed without opening GitHub. Words in [copy.md](copy.md#reference-copy).

- **Destination**: the row between Instructions and Tracks at the top of the mogi list and the sidebar, at `/?view=release-notes`. It opens like Tracks. The maintainer chose this place: next to Instructions, since both are about the app rather than a mogi; Settings holds only settings and actions. Nothing else announces it, in keeping with silence when everything is right.
- **Page**: dates newest first; under each, one short line per change, marked New or Fixed. Lines say what changed for the player, with no PR numbers, internal names or engine terms.
- **What goes in**: only critical fixes (wrong results, lost data or blocked use) and genuinely new features. Visual changes, copy trims, polish and internal changes stay out; related changes share one line.
- **Source**: `apps/web/release-notes.json`, bundled at build time, so the page works offline. `lib/release-notes.test.ts` (app rules) checks its shape and that dates descend.
- **Upkeep**: a PR with a critical fix or a new feature adds its line in the same PR, under its merge date (a new date goes on top); a change that alters or removes a feature also edits the lines that name it.

## Regular navigation

There are only compact and regular ([size classes](design-system.md#size-classes)); desktop follows tablet.

- From a 1280 px viewport up, the sidebar is docked beside the content; below that, it floats with a scrim and closes when a mogi is selected. Closing the docked sidebar is remembered on the device; by default, it starts open.
- The sidebar header lines up with the toolbar (in the installed app's title bar, both shrink to the window controls' band) and holds the app's name at its leading edge and Settings, New Mogi and, docked, Hide Mogis at its trailing edge; the list starts at its first section. Floating, the sidebar opens below the toolbar, whose toggle stays in place as Hide Mogis and closes it; the overlay has no toggle of its own. Hiding the docked sidebar moves the toggle (Show Mogis) into the toolbar, with focus; the docked sidebar slides its width away and the content widens. With no mogi open and the sidebar closed, New Mogi appears in the toolbar.
- Opening with no mogi in the URL: on regular, resume the in-progress `activeMogiId`, else the most recently created in-progress mogi, replacing the history entry; failing both, a sentence points to the list or New Mogi. On compact, resume the in-progress `activeMogiId` with the list behind it, else start on the list. With no mogis at all, both open [Instructions](#instructions): on compact with the list behind it, on regular in place of the list. Links to a mogi and Back/Forward follow the URL.
- **No mogis**: empty state with New Mogi and Restore from Backup (Settings › Storage); on compact, in place of the list; on regular, in the content, with the bar. The sidebar holds only Instructions, Release Notes and Tracks; on compact, they sit above the empty state.
- **Data won't open**: the failure empty state fills the whole screen, alone, with Reload, Restore from Backup and Manage Storage. A confirmed restore can replace the data even after the initial read failed. These three are the only exits; deleting data stays out.

## Storage

Settings › Storage (`components/storage-panel.tsx`, `components/storage-mogi.tsx`). Groups, in this order: **Usage** (usage and quota from `navigator.storage.estimate()`; with no estimate, the page omits the meter), **Backup** (Save Backup hands the [ZIP](backup.md) to the browser even while saves fail, because it only reads the in-memory state; Restore from File… opens the restore preview), **Before updates** (the [automatic backups](backup.md#automatic-backups-before-updating), hidden until the first one exists), **Mogis** (largest to smallest; only finished mogis open a page, with a chevron; in-progress ones are plain rows with no chevron or press state) and an untitled **Persistent storage** row. Backup and Persistent storage carry no note: the replacement warning lives in the Replace All Data confirmation.

- **Returning is instant**: a mogi's row (size, finished) is cached per mogi object, so reopening Storage, such as Back from a mogi's page, projects only the mogis a save replaced; the last usage reading shows while a fresh one loads.

- A mogi's page offers "Delete Screenshots" (only while there are images) and "Delete Mogi", each with a confirmation. Deleting images removes only the original bytes: results, table, metadata and questions stay, and the page remains. Deleting the mogi returns to Storage.
- Capture without an image: the Screenshots list shows `ImageOff` in place of the thumbnail; detail and viewer use the deleted-image placeholder.
- Each launch silently requests `navigator.storage.persist()` until storage becomes persistent; the result appears only on this page.

## Failure alerts

A failure that blocks work is a `BlockingAlert` over the mogi, the list or a sheet. At most one, the most severe first: save, other window, stale. Only the buttons close it, because the change is still unsaved.

- **Save**: the cause comes straight from `DOMException.name` (`storageFailure` in `lib/mogi/session.ts`). On *quota* and *unknown*, "Try Again" retries the same save over the latest state (a new failure keeps the alert) and "Manage Storage" opens Settings › Storage; *updated* has only "Reload".
- **Other window**: a save refused because of another window's revision, or a header Copy !submit with changed data, opens the alert with "Reload". In Export, the refusal stays inline.
- **Stale**: the title is the first sentence of the reason; the only button is the recovery action.

`TriangleAlert` only where data may be lost or is still unsaved: the quota and unknown alerts and the failure-to-open screen.

## Edits in progress and refusals

Both appear next to the affected race or control.

- **Edit in progress**: the draft persists silently as it changes: no saving status, and its writes never lock the editor, since only Save Result changes the result. It appears only on the race tile (pencil in the corner, keeping the tile's state) and in the race sheet (subtitle). The tile always opens the sheet, even for an unseen race. In place of "Edit Result": "Resume Edit" (primary) and "Discard Edit" (destructive, with confirmation). Discarding keeps the sheet open and brings back "Edit Result", focused. Resuming a stale draft opens the stale-data alert.
- **Refused action** (e.g. editing another race with an edit in progress): the reason sentence right below the control group that triggered the action (`ActionScope`), or at the end of the sheet; it clears on using any control. When there is no surface (background action, alert button, Undo or Add Screenshots in the bar), it becomes a toast.

## Players

One row per person: Lounge name and distinct IGNs in muted, truncated to one line even at 375 px. A substitution puts the race range in the trail, on the same row.

## Mogi Settings

Two untitled groups: Bot List › (the text pasted at creation, read-only), Screenshots › (trail: their count) and Export ›; then Delete Mogi alone, destructive, confirmed by "Delete <mogi name>?". That is everything; screenshots stay in the mogi they entered.

**Screenshots** lists every screenshot, including those without a race: thumbnail, race label and moment, file name. The detail, in this order:

1. Race ›, Moment and Screen (name from the [glossary](../../GLOSSARY.md) and the engine's `screens` catalog).
2. "How this was counted": the engine projection's decisions, each titled by the decision with its source (Read, Deduced, Your answer) as the trail, and a reason below only when it says more than the source. Pending names are one "Not counted yet" row with its question count. Tapping the race decision opens the Race › correction.
3. Numbers Read ›, only when the capture has numbers read.
4. Remove Screenshot.

**From a race**: the race sheet's Screenshots › (trail: their count; shown while the race has any, a discarded race included) lists that race's screenshots alone (`captureRace`, `lib/mogi/capture-label.ts`), pre-race and repeats included, so one that hurts recognition comes out without searching the whole mogi. It is a page of the race sheet, as the Track row's picker is: titled Screenshots, with Back to the race, and each row opens the same detail as a further page of that sheet. Removing recounts the mogi exactly as from the full list, with [Undo](#controls), and returns to the race's list; closing returns focus to the race's tile.

## Capture viewer

Every screenshot or crop opens on tap in the same `CaptureViewer` (`components/ui/capture-viewer.tsx`): question sheet, Images detail, name review, race editor, track picker and the Pasted Screenshot sheet. Images thumbnails stay rows that open the detail.

- Fullscreen and opaque: the image is content. Close and label at the top; with two captures, navigation at the bottom. Everything inside the safe areas.
- **compact**: pinch, double tap and drag to zoom and pan; at 1×, swiping down closes and swiping sideways changes capture.
- **regular**: click toggles zoom at the point; ctrl + wheel and trackpad pinch zoom; ← and →, and at 1× a two-finger trackpad swipe, change capture; Escape closes only the viewer, keeping the source sheet. The viewer takes every horizontal trackpad swipe at 1×, so the browser's back swipe never fires over it.
- Changing capture returns to 1×. The page behind stays still, with its layout intact. On close, focus returns to the tapped crop.

## Paging

A sheet opened from a list of races pages among that list's siblings without closing; a nested task pages nothing, as Photos pages while browsing but not inside Edit. Siblings come from `raceSiblings` (`components/mogi-overview.tsx`); controls and gestures from the [design system](design-system.md#surfaces).

- **Race sheet**: pages among the races whose tile opens a race sheet (counted, pending, or with an edit in progress), in race order; a discarded race pages among the discarded. Only the race page pages: Edit Result, the Track page and the Screenshots pages inside it don't. Closing returns focus to the tile of the race on screen.
- **Track picker from the Tracks list or the wide table's column** (the Track sheet), **or from a Table sheet column** (its picker page): pages among the resolved races' pickers, each starting with an empty search. Back from the Table sheet's picker returns to the column of the race on screen.
- **Track picker from the race sheet's Track row**: no paging. It is a pick-and-return task; Back returns to that race, which pages itself.

## Edit Result

Races come from captures; Edit Result corrects a race and creates one only for a ghost race, through Enter Result ([Needs screenshots](#structure)). It is a page of the race sheet (`components/race-editor.tsx`), opened by Edit Result, and by Edit Full Result in Review Screenshot, whose Back returns to the review.

- Top to bottom: the capture, **Finish order** (place, player, and Lounge points under the column heading "Points"; "Read as “X”" only when the reading differs from the player), **Absent** (only when there is one) and **More options**, always shown.
- A place opens a page of players, with the current one checked and the others' places in the trail. Choosing swaps the two places and returns; an empty place takes only a player without one.
- **A race without a screenshot** (a ghost race entered by hand, or a manual result): a race whose screenshot wasn't recognized shows that screenshot where the capture sits ("Screenshot of race N"). The app reads every image it has, so Edit Result attaches no reference-only photo. When every earlier race's totals are proven, a second column headed "Total" shows each player's total after this race, to compare with the game's totals. Saving counts the race as a manual result; later images that contradict it follow [reconstruction](reconstruction.md).
- **Revert to Screenshots**: in the race sheet, under Edit Result, on a manual result of a race with a screenshot or an archived proof, and no edit in progress. Destructive, with confirmation; it removes the typed result and its absences, and the race counts again from what the screenshots prove. It is the only way back from Save Result: [Undo](#controls) covers image removal alone.
- **Don't Count This Race**: the race sheet's last group, below Screenshots and Edit Result, for a race that took place but doesn't count for the Lounge. A plain command, not destructive: the result and screenshots stay, and Count Again, in the same place on the discarded race, undoes it. A bad screenshot comes out through Screenshots › instead.
- More options holds what screenshots rarely need: Absent Players (at most two, 1 point each; a DC or an unread name is not an absence). In-game points have no field: the represented count fixes them ([native points](scoring.md#native-points)). The full absence rule lives in [Instructions](#instructions), under "Fix races and names".
- **Save Result** floats in the footer. Saving is the review: there is no separate "I checked" step. The draft and Edit in progress work as in [Edits in progress](#edits-in-progress-and-refusals).

## Table and image

The table shows the number of every race, including races with questions or needing images: the column stays the same with questions. A column's number, like the race's row in Tracks, does what that race's progress tile does: a race with questions opens its questions, one needing images opens the reason, a pending race or one with an edit in progress opens its sheet. Only a resolved (counted) race opens its track picker directly; the rest of the table is static. There is a single track picker, opened the same way from the column and from the race sheet's Track row; only where it was opened from decides whether it [pages](#paging). It shows the race's screenshot first when the race has one (the pre-race one that shows the track, otherwise the race's own), and no image when it has none, such as a manual result. The image and the track list scroll together in the sheet's one scroller, and tapping the image opens the viewer. The picker's page covers the race page, so it carries the image itself. In the Table sheet the picker is a page, and choosing or Back returns to the table, focused on the column; from the wide table it is its own sheet, which closes on choosing. The race itself opens from its race progress tile, and its sheet keeps the Track row. Unproven totals stay unknown. A race that happened with no known track uses the Item Box; future races stay blank. The copied PNG reproduces the table's wide presentation (`tablePng`, `lib/mogi/exports.ts`; `tests/table-image.spec.ts`).
