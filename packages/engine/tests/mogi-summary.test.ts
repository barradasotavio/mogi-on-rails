import assert from "node:assert/strict";
import test from "node:test";

import { type Mogi, mogiQuestions, mogiSummary, teamStandings } from "@mkw/engine";

const participants = Array.from({ length: 12 }, (_, index) => ({
  id: `p${index + 1}`,
  loungeName: `Player ${index + 1}`,
  ign: `IGN ${index + 1}`,
}));
const fresh: Mogi = {
  id: "m",
  name: "Custom name",
  submissionTier: "D",
  format: "FFA",
  createdAt: "2026-10-28T12:00:00Z",
  participants,
  races: [],
};
const racing: Mogi = {
  ...fresh,
  races: [
    { id: "r1", origin: "manual", number: 1, placements: participants.map(({ id }) => id) },
    { id: "r2", origin: "manual", number: 2, status: "pending", placements: [] },
    {
      id: "discard",
      origin: "manual",
      status: "discarded",
      placements: [...participants].reverse().map(({ id }) => id),
    },
  ],
};

test("a new mogi describes its twelve players before any established race", () => {
  assert.deepEqual(mogiSummary(fresh), {
    final: false,
    text: "12 players · no races yet",
  });
});

test("an FFA summary names the Lounge leader and counts only established results", () => {
  assert.deepEqual(mogiSummary(racing), {
    final: false,
    text: "Race 1 of 12 · Player 1 leads with 15",
  });
});

test("team formats describe the leading team rather than the individual winner", () => {
  for (const [size, points] of [
    [2, 27],
    [3, 37],
  ]) {
    const teamed: Mogi = {
      ...racing,
      format: size === 2 ? "2v2" : "3v3",
      participants: participants.map((person, index) => ({ ...person, teamId: `t${Math.floor(index / size)}` })),
      teams: Array.from({ length: 12 / size }, (_, index) => ({ id: `t${index}`, name: `Team ${index + 1}` })),
    };
    assert.deepEqual(mogiSummary(teamed), {
      final: false,
      text: `Race 1 of 12 · Team 1 leads with ${points}`,
    });
  }
});

const finished: Mogi = {
  ...fresh,
  races: Array.from({ length: 12 }, (_, index) => ({
    ...racing.races[0],
    id: `r${index + 1}`,
    number: index + 1,
  })),
};

test("a final mogi describes its winner while unresolved questions keep it in progress", () => {
  assert.deepEqual(mogiSummary(finished), { final: true, text: "Player 1 won · 180" });
  const unresolved: Mogi = {
    ...finished,
    captures: [
      {
        id: "question",
        width: 1920,
        height: 1080,
        rows: [],
        stage: "context",
        reviewedAt: "2026-10-28",
        reviewedPlacements: [],
        context: { phase: "after" },
      },
    ],
  };
  assert.deepEqual(mogiSummary(unresolved), {
    final: false,
    text: "Race 12 of 12 · Player 1 leads with 180",
  });
  assert.deepEqual(
    mogiSummary({
      ...finished,
      races: finished.races.map((race) => (race.number === 12 ? { ...race, status: "discarded" } : race)),
    }),
    {
      final: false,
      text: "Race 11 of 12 · Player 1 leads with 165",
    },
  );
});

test("stored team names do not replace the numbered team in the final summary", () => {
  const teamed: Mogi = {
    ...finished,
    format: "2v2",
    participants: participants.map((person, index) => ({ ...person, teamId: `t${Math.floor(index / 2)}` })),
    teams: Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, name: `Stored team ${index + 1}` })),
  };
  assert.deepEqual(mogiSummary(teamed), { final: true, text: "Team 1 won · 324" });
});

test("team questions and leaders use the effective tag or team number, ignoring stored names", () => {
  for (const size of [2, 3]) {
    const teamed: Mogi = {
      ...racing,
      format: size === 2 ? "2v2" : "3v3",
      participants: participants.map((person, index) => ({
        ...person,
        ign: index === 0 ? "KRJ funk" : index === 1 ? "KRJ toad" : `IGN ${index + 1}`,
        teamId: `t${Math.floor(index / size)}`,
      })),
      teams: Array.from({ length: 12 / size }, (_, index) => ({ id: `t${index}`, name: `Stored team ${index + 1}` })),
    };
    const points = size === 2 ? 27 : 37;
    for (const [tag, expected] of [
      [undefined, "KRJ"],
      ["  XO  ", "XO"],
      ["", "Team 1"],
    ] as const) {
      const current = { ...teamed, teams: teamed.teams!.map((team, index) => (index === 0 ? { ...team, tag } : team)) };
      assert.equal(mogiSummary(current).text, `Race 1 of 12 · ${expected} leads with ${points}`);
      assert.equal(teamStandings(current)[0].name, expected);
      const question = mogiQuestions({
        ...current,
        participants: current.participants.map((person, index) =>
          index === 11 ? { ...person, teamId: undefined } : person,
        ),
      }).find((q) => q.kind === "team");
      assert.equal(question?.kind === "team" && question.options[0].label, expected);
    }
    const untagged = {
      ...teamed,
      participants: teamed.participants.map((person, index) => ({
        ...person,
        ign: index === 0 ? "funk" : index === 1 ? "toad" : person.ign,
      })),
    };
    assert.equal(mogiSummary(untagged).text, `Race 1 of 12 · Team 1 leads with ${points}`);
  }
});

test("the original roster keeps pasted text and is rebuilt for old mogis without substitutions (mogiOriginalList)", async () => {
  const { mogiOriginalList } = await import("@mkw/engine");
  const pasted = "**Tier D**\r\nRoom 42\r\n1. Player 1 (9000 MMR)\r\n";
  assert.equal(mogiOriginalList({ ...fresh, originalList: pasted }), pasted);
  for (const [format, size] of [
    ["FFA", 1],
    ["2v2", 2],
    ["3v3", 3],
  ] as const) {
    const legacy: Mogi = {
      ...fresh,
      format,
      participants: [
        ...participants.map((person, index) => ({ ...person, teamId: `t${Math.floor(index / size)}` })),
        { id: "sub", slotId: "p1", loungeName: "Replacement", ign: "Sub" },
      ],
    };
    const text = mogiOriginalList(legacy);
    assert.ok(text.startsWith(`Tier D\n${format}\n1. Player 1${size > 1 ? ", Player 2" : "\n"}`));
    assert.ok(
      text.endsWith(
        size === 3 ? "4. Player 10, Player 11, Player 12" : size === 2 ? "6. Player 11, Player 12" : "12. Player 12",
      ),
    );
    assert.ok(!text.includes("Replacement"));
    assert.ok(!text.includes("IGN"));
  }
});

/** The first `tied` teams (blocks of `size` players) take turns at the top, so after any multiple of `tied` races they share first. */
function tiedMogi(format: Mogi["format"], size: number, tied: number, races: number): Mogi {
  return {
    ...fresh,
    format,
    participants: participants.map((person, index) => ({
      ...person,
      teamId: size > 1 ? `t${Math.floor(index / size)}` : undefined,
    })),
    teams:
      size > 1
        ? Array.from({ length: 12 / size }, (_, index) => ({ id: `t${index}`, name: `Team ${index + 1}` }))
        : undefined,
    races: Array.from({ length: races }, (_, race) => {
      const blocks = Array.from({ length: 12 / size }, (_, block) =>
        participants.slice(block * size, block * size + size).map(({ id }) => id),
      );
      const top = blocks.slice(0, tied);
      const order = [...top.slice(race % tied), ...top.slice(0, race % tied), ...blocks.slice(tied)];
      return { id: `r${race + 1}`, origin: "manual" as const, number: race + 1, placements: order.flat() };
    }),
  };
}

test("every leader tied for first is named, or counted when the names would not fit", () => {
  for (const [format, size, unit, label, perCycle] of [
    ["FFA", 1, "players", "Player", [27, 37, 46]],
    ["2v2", 2, "teams", "Team", [46, 61, 72]],
  ] as const) {
    const names = (tied: number) => Array.from({ length: tied }, (_, index) => `${label} ${index + 1}`);
    for (const [tied, who] of [
      [2, names(2).join(" and ")],
      [3, `${names(2).join(", ")} and ${label} 3`],
      [4, `4 ${unit}`],
    ] as const) {
      const points = perCycle[tied - 2];
      assert.deepEqual(mogiSummary(tiedMogi(format, size, tied, tied)), {
        final: false,
        text: `Race ${tied} of 12 · ${who} are tied at ${points}`,
      });
      assert.deepEqual(mogiSummary(tiedMogi(format, size, tied, 12)), {
        final: true,
        text: `${who} are tied · ${(points * 12) / tied}`,
      });
    }
  }
});
