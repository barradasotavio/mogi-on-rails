# T05 general/final source fixtures

No additional remote fetch. The spec29 captures are reused, with [player names edited](../README.md#player-names); each SHA-256 is the unedited original's:

- `overall-order.jpeg` = IMG_0335.jpeg, SHA-256 `442f830d6639d8f5e1f19815ffbda292b83025cc79f6d370719cb1ca76b0b958`: right-side general standings, total738. Source row7 is Tavo, general rank7, cumulative60; no finish order is established.
- `complement-unknown.jpeg` = IMG_0340.jpeg, SHA-256 `59d20306e97d6a04dac2cf71fd289cdbb2f5737c6df2361c4aa35d24cfb5e1b2`: event-final left-side general list, total984. Rows5/6 display rank5, then rank7. Tavo is source row2/general rank2/cumulative97.
- `finish-order-totals.jpeg` = IMG_0339.jpeg, SHA-256 `6e70fadd0fe269f5f6037e1f8066908eab334ac6f7fdebec674ba543d863d0e4`: same totals984, different order. ShyLuigi is finish position 2 with52; Tavo finish position 8 with97. Comparing to F1 by row index would be wrong.

Provenance: supplied authentic Photos captures copied without modification into ux-capture-spec/reference-captures, then introduced by T04. See parent fixture README and shared corpus-notes.md for the independent visual transcription. They are local test evidence, not classifier tables; runtime never branches on filename, SHA or expected totals.

F1 header OCR is imperfect on this authentic stylized banner. Its detector uses the observed red/yellow banner, independent left-list rank extent and stable descending values. Rank glyphs1–4 and some inner ranks can remain unreadable/uncertain; raw observations are preserved, never replaced with source indices. One real right-column value reads017 ambiguously instead of77; the public scenario answers77 explicitly from the original rather than weakening numeric uncertainty. These bounded samples do not establish general classifier accuracy or physical-device operation.
