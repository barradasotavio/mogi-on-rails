# Spec 29 authentic screenshots

User-supplied screenshots from the reference captures kept on 2026-10-26, with [player names edited](../README.md#player-names); the SHA-256 is the unedited original's. Test-only, outside the app bundle; names, avatars and game artwork belong to their owners, and the code's MIT notices cover only the code. Values in tests are transcriptions of these images; the app recognizes from pixels only. Pre-race sources: [pre-race-provenance.md](pre-race-provenance.md); other `*-provenance.md` files cover later slices.

| File | Original, screen | Original SHA-256 | Proves |
| --- | --- | --- | --- |
| `finish-order-additions.jpeg` | IMG_0338, `finishOrderAdding` | `020d34615f1caa089622efce7384bdf7c60157c5b825e6b6df7049e15e7c0bee` | Complete native addition scale and finish order only; the exact animation moment and residual additions need other captures. |
| `finish-order-totals.jpeg` | IMG_0339, `finishOrderAdded` | `6e70fadd0fe269f5f6037e1f8066908eab334ac6f7fdebec674ba543d863d0e4` | Final totals summing 984 in finish order; the twelve-race breakdown stays unproven. The default real image for app browser tests. |
| `complement-unknown.jpeg` | IMG_0340, `finalStandings` | `59d20306e97d6a04dac2cf71fd289cdbb2f5737c6df2361c4aa35d24cfb5e1b2` | No test reads it since the Paddle experiment was removed; kept with its provenance (t05, t10). |
| `overall-order.jpeg` | IMG_0335, `overallStandings` | `442f830d6639d8f5e1f19815ffbda292b83025cc79f6d370719cb1ca76b0b958` | Negative control: the app treats its overall order as overall standings only. |
