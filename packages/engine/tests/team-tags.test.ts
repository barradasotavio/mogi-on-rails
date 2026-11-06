import assert from "node:assert/strict";
import { test } from "node:test";

import { inferTeamTags, type Mogi, teamLabel } from "@mkw/engine";

/** 2v2 mogi whose in-game names follow the bot list order, two per team. */
function pairs(igns: string[], tags: (string | undefined)[] = []): Mogi {
  return {
    id: "m",
    name: "Mogi",
    format: "2v2",
    createdAt: "2026-10-29",
    races: [],
    teams: Array.from({ length: 6 }, (_, t) => ({
      id: `team-${t + 1}`,
      name: `Stored name ${t + 1}`,
      ...(tags[t] === undefined ? {} : { tag: tags[t] }),
    })),
    participants: igns.map((ign, n) => ({
      id: `p${n + 1}`,
      loungeName: `Player ${n + 1}`,
      ign,
      teamId: `team-${Math.floor(n / 2) + 1}`,
    })),
  };
}
const shown = (mogi: Mogi) => inferTeamTags(mogi).map((team) => team.tag);
const filler = ["Ana", "Bia", "Cid", "Duda", "Eva", "Fred", "Gil", "Hugo"];

test("the tag is the prefix most members share, preferring a space after it and then the longest", () => {
  // XO and X have the same support; the one separated from the name by a space wins.
  assert.equal(shown(pairs(["XO Tavo", "XO Kamek", ...filler, "Iago", "Juca"]))[0], "XO");
  // Without a space, D and DK tie on support and the longest wins.
  const trio: Mogi = {
    ...pairs([]),
    format: "3v3",
    teams: Array.from({ length: 4 }, (_, t) => ({ id: `team-${t + 1}`, name: `Stored name ${t + 1}` })),
    participants: ["DKzer", "DKyon", "Foo", ...filler, "Iago"].map((ign, n) => ({
      id: `p${n + 1}`,
      loungeName: `Player ${n + 1}`,
      ign,
      teamId: `team-${Math.floor(n / 3) + 1}`,
    })),
  };
  assert.deepEqual(inferTeamTags(trio)[0], { teamId: "team-1", number: 1, tag: "DK", inferred: "DK", chosen: false });
});

test("a split pair needs a space after the tag, and unrelated names give no tag", () => {
  assert.equal(shown(pairs(["VS Kamek", "Tavo", ...filler, "Iago", "Juca"]))[0], "VS");
  assert.equal(shown(pairs(["Tavo", "Kamek", ...filler, "Iago", "Juca"]))[0], null);
  assert.equal(inferTeamTags(pairs(["Tavo", "Kamek", ...filler, "Iago", "Juca"]))[0].inferred, null);
});

test("two teams that seem to use the same tag both show their number, while a longer tag stays", () => {
  const tags = inferTeamTags(
    pairs(["D Ana", "D Bia", "D Cid", "D Duda", "DK Eva", "DK Fred", "Gil", "Hugo", "Iago", "Juca", "Kai", "Lia"]),
  );
  assert.deepEqual(
    tags.slice(0, 3).map(({ tag, inferred }) => [tag, inferred]),
    [
      [null, "D"],
      [null, "D"],
      ["DK", "DK"],
    ],
  );
  const mogi = pairs([
    "D Ana",
    "D Bia",
    "D Cid",
    "D Duda",
    "DK Eva",
    "DK Fred",
    "Gil",
    "Hugo",
    "Iago",
    "Juca",
    "Kai",
    "Lia",
  ]);
  assert.equal(teamLabel(mogi, "team-1"), "Team 1");
  assert.equal(teamLabel(mogi, "team-2"), "Team 2");
  assert.equal(teamLabel(mogi, "team-3"), "DK");
});

test("a chosen tag always wins, an empty one clears it, and it can free a colliding team", () => {
  const igns = ["D Ana", "D Bia", "D Cid", "D Duda", "XO Eva", "XO Fred", "Gil", "Hugo", "Iago", "Juca", "Kai", "Lia"];
  const tags = inferTeamTags(pairs(igns, ["MK", undefined, ""]));
  assert.deepEqual(tags.slice(0, 3), [
    { teamId: "team-1", number: 1, tag: "MK", inferred: "D", chosen: true },
    { teamId: "team-2", number: 2, tag: "D", inferred: "D", chosen: false },
    { teamId: "team-3", number: 3, tag: null, inferred: "XO", chosen: true },
  ]);
  // A chosen tag equal to another team's inferred one wins, and the other is left without a tag.
  assert.deepEqual(shown(pairs(igns, [undefined, undefined, "D"])).slice(0, 3), [null, null, "D"]);
});

test("substitutes don't change the tag and FFA has no teams", () => {
  const mogi = pairs(["XO Tavo", "XO Kamek", ...filler, "Iago", "Juca"]);
  const sub = { id: "p13", loungeName: "Sub", ign: "Zed", teamId: "team-1", slotId: "p1" };
  assert.equal(shown({ ...mogi, participants: [...mogi.participants, sub] })[0], "XO");
  assert.deepEqual(inferTeamTags({ ...mogi, format: "FFA", teams: undefined }), []);
});
