# `teamStandings` authentic source

`teams-board.jpeg` is the user-provided IMG_0337.jpeg from the reference captures kept on 2026-10-26, with [player names edited](../README.md#player-names); the unedited original's SHA-256 is `745a5d0ec0c2e890fb9c922c12ed2ff4353c7dd2e18b2bcf0a2fbf55d75d2421`. Test-only, outside the app bundle; image and game artwork belong to their owners, and the app-code MIT license covers only the code.

Visual oracle: four groups of three; team totals 186/259/108/184, summing 737. Lounge teams come from their own configuration; the groups and 737 are reading oracles only.

`apps/web/tests/recognition-contract.spec.ts` (Chrome only) checks that the four totals are read with certainty from the totals printed in the image, independently of the member sum. Scores stay free to vary. PP-OCRv6 Small read all totals correctly in Chrome and WebKit in a one-off probe, so Chrome alone is enough.
