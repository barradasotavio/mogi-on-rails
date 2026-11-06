import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultLoungeName,
  type Mogi,
  type Participant,
  type Race,
  RECENT_MOGIS,
  type Track,
  trackStandings,
  UNSTABLE_MIN_RACES,
  UNSTABLE_REACH,
} from "@mkw/engine";

function participant(id: string, loungeName: string): Participant {
  return { id, loungeName, ign: id };
}

const participants = Array.from({ length: 12 }, (_, index) =>
  participant(`p${index + 1}`, index === 0 ? "Alice" : `Player ${index + 1}`),
);

function race(id: string, place: number | null, track?: Track["short"], overrides: Partial<Race> = {}): Race {
  const placements = participants.slice(1).map((person) => person.id);
  placements.splice((place ?? 1) - 1, 0, place === null ? "" : "p1");
  return { id, origin: "manual", placements, track, ...overrides };
}

function mogi(id: string, races: Race[], overrides: Partial<Mogi> = {}): Mogi {
  return {
    id,
    name: `Mogi ${id}`,
    format: "FFA",
    createdAt: "2026-10-30T12:00:00Z",
    participants,
    races,
    ...overrides,
  };
}

test("a track's value uses every placed counted race in the mogi, including a race without a track", () => {
  const played = mogi(
    "played",
    [
      race("chosen", 2, "MBC", { status: "confirmed" }),
      race("reading", 6, undefined, { placements: ["p2", "p3", "p4", "p5", "p6", "returning"] }),
      race("trackless", 10),
      race("absent", null, "RR", { absentParticipantIds: ["p1"] }),
      race("absent-in-placements", 1, "RR", { absentParticipantIds: ["p1"] }),
      race("subbed-out", null, "RR", { placements: ["p2", "p3"] }),
      race("pending", 1, "RR", { status: "pending" }),
      race("discarded", 1, "RR", { status: "discarded" }),
      race("unknown-place", null, "RR"),
      race("missing-place", null, "RR", { placements: [] }),
      race("two-participants", 1, "RR", { placements: ["p1", "returning"] }),
    ],
    {
      format: "2v2",
      participants: [...participants, { ...participant("returning", " ALICE "), slotId: "p1" }],
      captures: [
        {
          id: "before",
          width: 1920,
          height: 1080,
          rows: [],
          stage: "context",
          reviewedAt: "2026-10-30",
          reviewedPlacements: [],
          context: { phase: "before", raceId: "reading" },
          interpretation: {
            version: 1,
            screen: "twoColumns",
            positions: [],
            movementRows: [],
            origin: "visual",
            reasons: [],
            nextTrack: { text: "Crown City", confidence: 99, uncertain: false },
          },
        },
      ],
    },
  );
  const mogis = [
    played,
    mogi("not-in-roster", [race("not-yours", 1, "RR")], { participants: participants.slice(1) }),
    mogi("only-trackless", [race("without-track", 1)]),
  ];
  const before = structuredClone(mogis);
  const standings = trackStandings(mogis, [" aLiCe "]);
  assert.deepEqual(standings.loungeNames, ["aLiCe"]);
  assert.equal(standings.mogis, 1);
  assert.equal(standings.races, 2);
  assert.equal(standings.olderMogis, 0);
  assert.deepEqual(
    standings.tracks.map((standing) => standing.track),
    [
      { short: "MBC", name: "Mario Bros. Circuit" },
      { short: "CC", name: "Crown City" },
    ],
  );
  assert.deepEqual(standings.tracks[0].races, [
    {
      mogiId: "played",
      mogiName: "Mogi played",
      format: "2v2",
      createdAt: played.createdAt,
      raceId: "chosen",
      raceNumber: 1,
      place: 2,
      points: 12,
      mogiAverage: 6,
      value: 4,
      recent: true,
      runningTypical: 4,
    },
  ]);
  const reading = standings.tracks[1].races[0];
  assert.equal(reading.raceId, "reading");
  assert.equal(reading.points, 7);
  assert.equal(reading.mogiAverage, 6);
  assert.equal(reading.value, 0);
  assert.deepEqual(
    standings.tracks.map(({ recent, typical, lowerQuartile, upperQuartile, worst, best }) => [
      recent,
      typical,
      lowerQuartile,
      upperQuartile,
      worst,
      best,
    ]),
    [
      [1, 4, 4, 4, 4, 4],
      [1, 0, 0, 0, 0, 0],
    ],
  );
  assert.deepEqual(mogis, before);
});

test("track standings rank typical, then counted races, then catalog order", () => {
  const standings = trackStandings(
    [
      mogi("ties", [
        race("summit", 2, "WS"),
        race("city", 2, "CC"),
        race("circuit-1", 2, "MBC"),
        race("circuit-2", 2, "MBC"),
        race("spaceport", 12, "DKS"),
      ]),
    ],
    ["Alice"],
  );
  assert.equal(standings.mogis, 1);
  assert.equal(standings.races, 5);
  assert.deepEqual(
    standings.tracks.map(({ track, recent, typical, unstable }) => ({
      track: track.short,
      recent,
      typical,
      unstable,
    })),
    [
      { track: "MBC", recent: 2, typical: 2, unstable: false },
      { track: "CC", recent: 1, typical: 2, unstable: false },
      { track: "WS", recent: 1, typical: 2, unstable: false },
      { track: "DKS", recent: 1, typical: -8, unstable: false },
    ],
  );
  const fractional = trackStandings(
    [mogi("fractional", [race("first", 1, "MBC"), race("second", 2), race("third", 2)])],
    ["Alice"],
  ).tracks[0];
  assert.equal(fractional.races[0].mogiAverage, 5 / 3);
  assert.equal(fractional.typical, 5 / 3 - 1);
});

test("an outlier loss leaves typical gains positive; quartiles interpolate sorted race values by type 7", () => {
  const standings = trackStandings(
    [
      mogi("outlier", [
        race("one", 1, "WS"),
        race("two", 2, "WS"),
        race("three", 3, "WS"),
        race("loss", 12, "WS"),
        race("city", 3, "CC"),
        race("trackless", 9),
      ]),
    ],
    ["Alice"],
  );
  assert.deepEqual(
    standings.tracks.map(({ track }) => track.short),
    ["WS", "CC"],
  );
  const standing = standings.tracks[0];
  assert.equal(standing.typical, 2.5);
  assert.equal(standing.cost, 2);
  assert.equal(standing.priority, -2);
  assert.equal(standing.lowerQuartile, -0.25);
  assert.equal(standing.upperQuartile, 3.25);
  assert.equal(standing.worst, -7);
  assert.equal(standing.best, 4);
  assert.equal(standing.unstable, false);
  assert.deepEqual(
    standing.races.map(({ value, runningTypical }) => [value, runningTypical]),
    [
      [4, 4],
      [3, 3.5],
      [2, 3],
      [-7, 2.5],
    ],
  );
});

test("track standings split recent race values above and below zero for medians and totals", () => {
  const standings = trackStandings(
    [
      mogi("mixed", [
        race("gain-one", 1, "WS"),
        race("gain-two", 3, "WS"),
        race("zero", 6, "WS"),
        race("loss", 10, "WS"),
        race("positive-only", 4, "CC"),
        race("trackless", 12),
      ]),
    ],
    ["Alice"],
  );
  assert.deepEqual(
    standings.tracks.map(({ track, typicalPlus, typicalMinus, totalPlus, totalMinus }) => [
      track.short,
      typicalPlus,
      typicalMinus,
      totalPlus,
      totalMinus,
    ]),
    [
      ["CC", 2, null, 2, null],
      ["WS", 4, -4, 8, -4],
    ],
  );
});

test("a track's running typical follows mogi creation and race number; instability needs three races and a usual range reaching both sides of zero", () => {
  const earlier = mogi("earlier", [race("second", 11, "RR", { number: 2 }), race("first", 1, "RR", { number: 1 })], {
    createdAt: "2026-10-30T01:00:00Z",
  });
  const later = mogi("later", [race("third", 3, "RR"), race("fourth", 11, "RR")], {
    createdAt: "2026-10-29T23:00:00-03:00",
  });
  const standings = trackStandings([later, earlier], ["Alice"]);
  const standing = standings.tracks[0];
  assert.equal(standings.mogis, 2);
  assert.equal(standings.races, 4);
  assert.deepEqual(
    standing.races.map(({ mogiId, raceId, value, runningTypical }) => ({ mogiId, raceId, value, runningTypical })),
    [
      { mogiId: "earlier", raceId: "first", value: 5, runningTypical: 5 },
      { mogiId: "earlier", raceId: "second", value: -5, runningTypical: 0 },
      { mogiId: "later", raceId: "third", value: 4, runningTypical: 4 },
      { mogiId: "later", raceId: "fourth", value: -4, runningTypical: 0 },
    ],
  );
  assert.equal(standing.typical, 0);
  assert.equal(standing.cost, 0);
  assert.equal(standing.priority, 0);
  assert.ok(standing.recent >= UNSTABLE_MIN_RACES);
  assert.ok(standing.lowerQuartile <= -UNSTABLE_REACH);
  assert.ok(standing.upperQuartile >= UNSTABLE_REACH);
  assert.equal(standing.unstable, true);

  const few = trackStandings([earlier], ["Alice"]).tracks[0];
  assert.ok(few.recent < UNSTABLE_MIN_RACES);
  assert.ok(few.lowerQuartile <= -UNSTABLE_REACH);
  assert.ok(few.upperQuartile >= UNSTABLE_REACH);
  assert.equal(few.unstable, false);
  const stable = trackStandings(
    [mogi("stable", [race("one", 1, "RR"), race("two", 7, "RR"), race("three", 12, "RR"), race("trackless", 12)])],
    ["Alice"],
  ).tracks[0];
  assert.equal(stable.recent, UNSTABLE_MIN_RACES);
  assert.ok(stable.lowerQuartile > -UNSTABLE_REACH);
  assert.ok(stable.upperQuartile >= UNSTABLE_REACH);
  assert.equal(stable.unstable, false);
});

test("the last 36 participant mogis set the window, including trackless mogis; all track races in it count", () => {
  const played = Array.from({ length: RECENT_MOGIS + 1 }, (_, index) =>
    mogi(`${index}`, [race("track", 2, "WS"), race("trackless", 10)], {
      createdAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
    }),
  );
  played[0].races = [race("old", 12, "WS"), race("old-only", 1, "RR")];
  played[1].races = [race("first", 2, "WS"), race("second", 10, "WS")];
  played[RECENT_MOGIS].races = [race("trackless", 1)];
  const standings = trackStandings(played.reverse(), ["Alice"]);
  assert.equal(standings.mogis, RECENT_MOGIS - 1);
  assert.equal(standings.races, RECENT_MOGIS);
  assert.equal(standings.olderMogis, 1);
  assert.deepEqual(
    standings.tracks.map(({ track }) => track.short),
    ["WS"],
  );
  const standing = standings.tracks[0];
  assert.equal(standing.races.length, RECENT_MOGIS + 1);
  assert.deepEqual(
    standing.races.map(({ mogiId }) => mogiId),
    ["0", "1", ...Array.from({ length: RECENT_MOGIS - 1 }, (_, index) => `${index + 1}`)],
  );
  assert.deepEqual(
    standing.races.map(({ recent }) => recent),
    standing.races.map((_, index) => index > 0),
  );
  assert.equal(standing.races[0].runningTypical, null);
  assert.equal(standing.races[1].runningTypical, 4);
  assert.equal(standing.races[2].runningTypical, 0);
  assert.equal(standing.races.at(-1)?.runningTypical, 4);
  assert.equal(standing.recent, RECENT_MOGIS);
  assert.equal(standing.typical, 4);
  assert.equal(standing.cost, 4 * (RECENT_MOGIS - 2));
  assert.equal(standing.priority, -4 * (RECENT_MOGIS - 2));
  assert.equal(standing.lowerQuartile, 4);
  assert.equal(standing.upperQuartile, 4);
  assert.equal(standing.worst, -4);
  assert.equal(standing.best, 4);
  assert.equal(standing.unstable, false);
});

test("practice priority is the negative sum of race values in the window; higher means practice first", () => {
  const standings = trackStandings(
    [
      mogi("severe", [race("track", 12, "WS"), race("first", 3), race("second", 3)]),
      mogi("frequent", [race("first", 8, "CC"), race("second", 8, "CC"), race("trackless", 2)]),
      mogi("positive", [race("track", 2, "MBC"), race("trackless", 10)]),
    ],
    ["Alice"],
  );
  assert.deepEqual(
    standings.tracks.map(({ track, recent, typical, cost, priority }) => [
      track.short,
      recent,
      typical,
      cost,
      priority,
    ]),
    [
      ["MBC", 1, 4, 4, -4],
      ["CC", 2, -2, -4, 4],
      ["WS", 1, -6, -6, 6],
    ],
  );
  assert.deepEqual(
    [...standings.tracks].sort((a, b) => b.priority - a.priority).map(({ track }) => track.short),
    ["WS", "CC", "MBC"],
  );
});

test("the default Lounge name is the single name in every mogi, ignoring case and whitespace", () => {
  const first = mogi("first", [], {
    participants: [participant("a", " Alice "), participant("b", "Bob"), participant("blank", " ")],
  });
  const second = mogi("second", [], {
    participants: [participant("a1", "ALICE"), participant("a2", "alice"), participant("c", "Carol")],
  });
  assert.equal(defaultLoungeName([first, second]), "Alice");
  assert.equal(
    defaultLoungeName([{ ...second, participants: second.participants.slice(0, 2) }])?.toLowerCase(),
    "alice",
  );
  assert.equal(defaultLoungeName([first, first]), null);
  assert.equal(defaultLoungeName([first, mogi("different", [], { participants: [participant("c", "Carol")] })]), null);
  assert.equal(defaultLoungeName([mogi("empty", [], { participants: [participant("blank", " ")] })]), null);
  assert.equal(defaultLoungeName([]), null);
});

test("track standings need a chosen Lounge name and a placed counted race on a track", () => {
  const played = mogi("played", [race("first", 1, "MBC")]);
  for (const names of [[], [""], ["  "]]) {
    assert.deepEqual(trackStandings([played], names), {
      loungeNames: [],
      mogis: 0,
      races: 0,
      olderMogis: 0,
      tracks: [],
    });
  }
  assert.deepEqual(trackStandings([played], [" Nobody "]), {
    loungeNames: ["Nobody"],
    mogis: 0,
    races: 0,
    olderMogis: 0,
    tracks: [],
  });
  assert.deepEqual(trackStandings([], ["Alice"]), {
    loungeNames: ["Alice"],
    mogis: 0,
    races: 0,
    olderMogis: 0,
    tracks: [],
  });
});

test("every one of your Lounge names counts as you, since a Lounge name can change", () => {
  const renamed = participants.map((person, index) => (index === 0 ? { ...person, loungeName: "Alicia" } : person));
  const before = mogi("before", [race("first", 1, "MBC")], { createdAt: "2026-10-01T12:00:00Z" });
  const after = mogi("after", [race("first", 3, "MBC")], { participants: renamed });
  const standings = trackStandings([after, before], ["Alice", " alicia ", "ALICE"]);
  assert.deepEqual(standings.loungeNames, ["Alice", "alicia"]);
  assert.equal(standings.mogis, 2);
  assert.deepEqual(
    standings.tracks[0].races.map((entry) => entry.mogiId),
    ["before", "after"],
  );
  assert.equal(trackStandings([after, before], ["Alice"]).mogis, 1);
});
