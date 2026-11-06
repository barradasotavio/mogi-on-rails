# T08 public sequence scenarios

No new image corpus was created. Tests reuse the authentic captures (player names edited) documented by T04/T05/T06: pre-race-individual-656.jpeg (IMG_0334), overall-order.jpeg (IMG_0335), pre-race-individual-820.jpeg (IMG_0333) and finish-order-additions.jpeg (IMG_0338). File names/hashes are provenance only, never inputs to inference. No OCR collaborator is mocked.

The authentic sequence has boundary sums656→738→820. Independent name-aligned gains are:

- RoyAmazing2/9; pauline3/6; VSPeach5/7; waluigi_rl7/8;21Cheeps9/10; Tavo15/1.
- Bowser10/5; Petez6/15; Ludwig8/2; DRYBONE1/3; boocookies4/4; Morton155512/12.

Both columns are full native12 vectors. The phases differ:0334/0333 are before their upcoming race;0335 is after. The tests enter only actual pending identity/numeric questions through the UI. A count is not obtained by dividing raw656/738/820. The staged0333→next11→0335 case verifies reuse of a pending9 ID created before the earlier image arrived.

Two simulations use public ZIP source/manual-fact input, with original bytes and raw OCR unchanged. Neither supplies inferred sequence, gaps, occurrences or solver output:

1. Manual cumulative answers [30,24,20,18,16,14,12,10,8,6,4,2] represent two native12 races with the same finishing order, total164. The origin/continuity/validity fact is then answered in the real UI. Without it, number remains unknown; with it, A1 denotes upcoming3.
2. Manual older counters20, manually known race8 with eleven or ten represented, native gains [12,10,9,8,7,6,5,4,3,2,1] or [11,9,8,7,6,5,4,3,2,1], and pauline's newer counter0. Tavo (and Morton1555 for ten) is explicitly absent in the manual result, with unresolved source associations; the raw source still has twelve rows. Other newer answers are20+the stated native gains. Stable10/9 anchors relate boundaries; the real UI records pauline's reset. This is manual-data compatibility evidence, not authentic10/11-player OCR precision or a count-based absence inference.

Storage-failure injection is only at the native IndexedDB write boundary. Cross-window tests use visible app controls and normal revision CAS. Exports/restores use public ZIP controls; tests do not inspect IndexedDB/React state or call internal domain helpers.

The initial new test file was mistakenly named capture-sequence.spec.ts, which already existed. It was renamed to capture-auto-sequence.spec.ts and the legacy file restored byte-for-byte while an early RED was running. That retained RED has a stale legacy sourcemap excerpt; its actual failure was the absent new sequence control. Every later run uses only capture-auto-sequence.spec.ts, with files unchanged during execution. No legacy test is claimed migrated by that RED.
