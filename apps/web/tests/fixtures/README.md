# App test fixtures

## `finish-order-IMG_0353.jpeg`

Authentic capture from the maintainer (27/10/2026), with [player names edited](#player-names) and its EXIF intact. It reproduces an unknown screen type, false motion cues and divergent attempts (scores 0 and 96), and keeps `DateTimeOriginal`. Used by `apps/web/lib/images/photo-moment.test.ts` and `apps/web/tests/roster-separation.spec.ts`.

## `disconnected-race/`

Real 2v2 mogi from the maintainer (06/11/2026), with [player names edited](#player-names): the eleven result screens (`race-NN.webp`) and the boards before races 6 and 10 (`before-NN.webp`). Tavo disconnected in race 5, which has no screen, and Cheep1 sat race 9 out (11-row result screen). Only these 13 of the mogi's 23 screens are kept: the two boards let races 4, 5 and 9 be reconstructed before their screens arrive. The originals were the app's stored WebP copies, so there is no EXIF (the test carries the photo times); each edit is re-encoded at the WebP quality whose numeric reading matches the original's, because a small number such as a `0` flips under re-encoding. Used by `packages/engine/tests/disconnected-race.test.ts` through `recognitions.json`, asserting the Lounge totals: race 5 reconstructed, race 4's screen beating answered places, assisted-group ids dropped.

## `recognitions.json`

Saved `recognizeImage` output of the fixtures it names, which the specs read instead of OCR. How it is regenerated: [ocr.md](../../../../docs/contracts/ocr.md#focused-validation).

The spec29 captures have their own READMEs in [spec29](spec29/README.md) and [spec29-teams](spec29-teams/README.md).

## Player names

Fixtures carry no real player names; the maintainer's own name, Tavo, is the only one kept. Every other name becomes a Mario Kart character-style name, one per player across images, JSON and tests, so a player keeps the same name everywhere.

A replacement keeps the reading difficulty and the context the fixture was created for:
- team tags and prefixes ("T ", "K ", "VS", "KR♪", "F☆"), symbols ("·ω·", "◇", "™"), length class and truncation at 10 characters;
- deliberate similarities: names that were confusable, or OCR variants of one another, stay so; a roster name that differs from its in-game name keeps differing the same way;
- in OCR strings without an image, the same misread applied to the new name, at a similar edit distance from the roster name.

To edit a screenshot, redraw only the name regions in the game's lettering, keep every other JPEG block and the EXIF, then run `recognizeImage` on the original and the edited image: screen type, numbers and groups must match, and each name must read with the same kind of difficulty. Inspect every edited image visually, and redo any whose text looks pasted or whose reading got easier or harder. Then regenerate `recognitions.json`.
