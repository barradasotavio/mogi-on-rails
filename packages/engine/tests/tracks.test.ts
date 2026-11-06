import assert from "node:assert/strict";
import { test } from "node:test";

import { type Capture, matchTrack, type Mogi, mogiQuestions, raceTrack, tracks } from "@mkw/engine";

import { trackBanner } from "../src/recognition/track-banner.ts";

test("track matching accepts English and Portuguese names and codes regardless of case, accents and punctuation", () => {
  assert.equal(tracks.length, 40);
  assert.equal(matchTrack("  BÓWSER’S castle! ")?.short, "BC"); // english-check: data (accent folding)
  assert.equal(matchTrack("sky high sundae")?.short, "rSHS");
  assert.equal(matchTrack("rWsH")?.name, "Wario Shipyard");
  assert.equal(matchTrack("Great Block Ruins")?.short, "GBR");
  assert.equal(matchTrack("Mario Circuit")?.short, "rMC");
  assert.equal(matchTrack("SNES Mario Circuit 1")?.short, "rMC1");
  assert.equal(matchTrack("PRAIA PEACH")?.short, "rPB");
  assert.equal(matchTrack("Céus Gelados")?.short, "rSHS"); // english-check: data
  assert.equal(matchTrack("Ruínas Bloco ?")?.short, "GBR"); // english-check: data
  assert.equal(matchTrack("SNES Ilha Chocolate 2")?.short, "rCI2");
  assert.equal(matchTrack("Ilha Chocolate 2")?.short, "rCI2");
  assert.equal(matchTrack("Choco Island 2"), null);
  assert.equal(matchTrack("SNES Praia Peach"), null);
  assert.equal(matchTrack(""), null);
  assert.equal(matchTrack("Circuit"), null);
  assert.equal(matchTrack("Mario Circuit / Mario Bros. Circuit"), null);
  assert.equal(matchTrack("Praia"), null);
  assert.equal(matchTrack("Ilha Chocolate"), null);
  assert.equal(matchTrack("Bowsers Cast1e"), null);
});

test("a track name followed by stray short fragments matches when exactly one track does", () => {
  assert.equal(matchTrack("Canais Salgados C")?.short, "SSS");
  assert.equal(matchTrack("Passagem DK ._ ab")?.short, "rDKP");
  assert.equal(matchTrack("SNES Vale Fantasma 2 C")?.short, "rGV2");
  assert.equal(matchTrack("Circuito Mario 1")?.short, "rMC1");
  assert.equal(matchTrack("Circuito Mario 1 e")?.short, "rMC1");
  assert.equal(matchTrack("SNES Vale Fantasma 1 2"), null);
  assert.equal(matchTrack("Canais Salgados Cxy"), null);
  assert.equal(matchTrack("Vale Fantasma C"), null);
});

test("every Portuguese track name and alias matches its track, with optional SNES prefixes", () => {
  const readings = [
    ["MBC", "Circuito Mario Bros."],
    ["CC", "Metrópole Coroada"], // english-check: data
    ["WS", "Pico Locomotiva"],
    ["DKS", "Centro Espacial DK"],
    ["rDH", "Colinas Desérticas"], // english-check: data
    ["rSGB", "Bazar Shy Guy", "Bazar do Masquito"],
    ["rWS", "Estádio Wario"], // english-check: data
    ["rAF", "Fortaleza Voadora"],
    ["rDKP", "Passagem DK"],
    ["SP", "Pico Boreal"],
    ["rSHS", "Céus Gelados"], // english-check: data
    ["rWSh", "Naufrágio Wario", "Galeão do Wario"], // english-check: data
    ["rKTB", "Praia Koopa Troopa"],
    ["FO", "Savana Selvagem"],
    ["rPB", "Praia Peach"],
    ["SSS", "Canais Salgados"],
    ["rDDJ", "Selva Dino Dino"],
    ["GBR", "Ruínas Bloco ?"], // english-check: data
    ["CCF", "Cataratas Cheep Cheep"],
    ["DD", "Gruta Dente-de-Leão"], // english-check: data
    ["BCi", "Cinema Bu"],
    ["DBB", "Vulcão Quebra-ossos"], // english-check: data
    ["rMMM", "Prado Mu Mu"],
    ["rCM", "Monte Achocolatado"],
    ["rTF", "Fábrica do Toad"], // english-check: data
    ["BC", "Castelo do Bowser"],
    ["AH", "Bosque das Bolotas"],
    ["rMC", "Circuito Mario", "Circuito do Mario"],
    ["PS", "Estádio Peach"], // english-check: data
    ["RR", "Estrada Arco-Íris"], // english-check: data
    ["rMC1", "Circuito Mario 1", "SNES Circuito Mario 1"],
    ["rMC2", "Circuito Mario 2", "SNES Circuito Mario 2"],
    ["rMC3", "Circuito Mario 3", "SNES Circuito Mario 3"],
    ["rGV1", "Vale Fantasma 1", "SNES Vale Fantasma 1"],
    ["rGV2", "Vale Fantasma 2", "SNES Vale Fantasma 2"],
    ["rGV3", "Vale Fantasma 3", "SNES Vale Fantasma 3"],
    ["rCI1", "Ilha Chocolate 1", "SNES Ilha Chocolate 1"],
    ["rCI2", "Ilha Chocolate 2", "SNES Ilha Chocolate 2"],
    ["rKB1", "Praia Koopa Troopa 1", "Praia Koopa 1", "SNES Praia Koopa Troopa 1", "SNES Praia Koopa 1"],
    ["rVL1", "Lago Baunilha 1", "SNES Lago Baunilha 1"],
  ];
  for (const [short, ...names] of readings) {
    for (const name of names) assert.equal(matchTrack(name)?.short, short, name);
  }
});

test("a race uses its chosen track before an associated pre-race reading, without asking questions", () => {
  const race = { id: "r1", origin: "manual" as const, placements: [], captureIds: ["a1"] };
  const capture: Capture = {
    id: "a1",
    width: 1920,
    height: 1080,
    rows: [],
    stage: "context",
    reviewedAt: "2026-10-29",
    reviewedPlacements: [],
    context: { phase: "before", raceId: race.id },
    interpretation: {
      version: 1,
      screen: "twoColumns",
      positions: [],
      movementRows: [],
      origin: "visual",
      reasons: [],
      nextTrack: { text: "Crown City", confidence: 99, uncertain: false },
    },
  };
  const mogi: Mogi = {
    id: "m",
    name: "Mogi",
    format: "FFA",
    createdAt: "2026-10-29",
    participants: [],
    races: [race],
    captures: [capture],
  };
  assert.deepEqual(raceTrack(mogi, race), { short: "CC", name: "Crown City", source: "capture" });
  assert.deepEqual(raceTrack(mogi, { ...race, track: "rMMM" }), {
    short: "rMMM",
    name: "Moo Moo Meadows",
    source: "manual",
  });
  assert.equal(
    raceTrack({ ...mogi, captures: [{ ...capture, context: { phase: "before" } }] }, { ...race, captureIds: [] }),
    null,
  );
  assert.equal(
    raceTrack({ ...mogi, captures: [{ ...capture, context: { phase: "after", raceId: race.id } }] }, race),
    null,
  );
  const translated = {
    ...capture,
    interpretation: {
      ...capture.interpretation!,
      nextTrack: { text: "Metrópole Coroada", confidence: 99, uncertain: false }, // english-check: data
    },
  };
  assert.deepEqual(raceTrack({ ...mogi, captures: [translated] }, race), {
    short: "CC",
    name: "Crown City",
    source: "capture",
  });
  const conflicting = {
    ...capture,
    id: "a2",
    interpretation: {
      ...capture.interpretation!,
      nextTrack: { text: "Rainbow Road", confidence: 99, uncertain: false },
    },
  };
  assert.equal(raceTrack({ ...mogi, captures: [capture, conflicting] }, race), null);
  assert.deepEqual(mogiQuestions(mogi), mogiQuestions({ ...mogi, captures: [translated] }));
});

test("the pre-race track crop follows the banner wherever the map places it, on light or dark ground", () => {
  const width = 1920,
    height = 1080;
  const map = (ground: [number, number, number], banner: { x: number; y: number }) => {
    const data = new Uint8ClampedArray(width * height * 4);
    const paint = (x0: number, y0: number, w: number, h: number, [r, g, b]: number[]) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([r, g, b, 255], (y * width + x) * 4);
    };
    paint(0, 0, width, height, ground);
    paint(banner.x, banner.y, 210, 36, [12, 12, 12]);
    for (let letter = 0; letter < 12; letter++)
      paint(banner.x + 12 + letter * 16, banner.y + 8, 9, 20, [250, 250, 250]);
    return { data, width, height };
  };
  const low = trackBanner(map([90, 160, 70], { x: 1400, y: 790 }))!;
  assert.ok(
    low.y <= 798 && low.y + low.height >= 818 && low.x <= 1412 && low.x + low.width >= 1597,
    JSON.stringify(low),
  );
  const dark = trackBanner(map([20, 20, 20], { x: 1100, y: 300 }))!;
  assert.ok(
    dark.y <= 308 && dark.y + dark.height >= 328 && dark.x <= 1112 && dark.x + dark.width >= 1297,
    JSON.stringify(dark),
  );
  assert.equal(trackBanner(map([90, 160, 70], { x: 0, y: 0 })), undefined);
});
