# Authentic pre-race sources for spec29 / T06

Originals supplied by the user, copied from the retained reference-captures directory, then [player names edited](../README.md#player-names). Each SHA-256 is the unedited original's: provenance, never a classification input. No OCR ground-truth lookup is used by the recognizer.

- pre-race-individual-656.jpeg = IMG_0334.jpeg; 10734ea36e3ecabd2aa81bc928ecae8153199700b6ab589d0a9e0cb65247831b. Two columns, cumulative sum656, upcoming Naufrágio Wario.
- pre-race-individual-820.jpeg = IMG_0333.jpeg; 850cabbfba0449c4c873ab8570ca3c1b5317a42125e40106aac996a9c23c2897. Same physical source order, sum820, upcoming Estrada Arco-Íris.
- pre-race-teams-655.jpeg = IMG_0336.jpeg; a49857b77409cba130fea0f8ab170cfb469fd1b5de2cd932be83ece02e6fcd04. Grouped pre-race grid with empty slots; sum655 including a visible zero, upcoming Circuito Mario Bros.

These images do not establish finish order, race number, numerical continuity, reset/absence or the Lounge team format. Track text refers to the upcoming race, not the prior result. Corpus arithmetic is a bounded external oracle; do not force totals or divide by82.

Bounded browser observations (2026-10-27): one A2 swatch produced hue values
2.74985–2.75421 in WebKit (six hue units per turn). Exact rounded bins split
rows7/8 from12 despite a maximum difference0.00436; the largest within-group
spread in this source was0.00956 and the closest different groups were0.44435
apart. Grouping now compares circular hues within0.05 (three degrees) against
every member, without transitive chaining, bot format or expected group size.
Saturation, occupied-row and track corroboration remain required. These are
observed bounds on this authentic source, not a universal color/palette promise.
The original hash, grouped655 vector and visible zero remain unchanged.

The820 next-track OCR was uncertain in both engines: Chrome showed
“Estrada Arco-lris”, WebKit “Estrada Arco-iris”. Tests preserve the actual raw
text/alternatives and keep the explicit “Estrada Arco-Íris” answer separate;
they do not require a less accurate glyph or a fixed confidence percentage.
