import assert from "node:assert/strict";
import { test } from "node:test";

import { decideMogiRoute } from "./route.ts";
import type { Mogi, TrackerState } from "./types.ts";

const ongoing: Mogi = {
  id: "ongoing",
  name: "Ongoing",
  format: "FFA",
  createdAt: "2026-10-28",
  participants: Array.from({ length: 12 }, (_, index) => ({
    id: `p${index}`,
    loungeName: `Player ${index}`,
    ign: `Player ${index}`,
  })),
  races: [],
};
const state: TrackerState = { version: 1, mogis: [ongoing], activeMogiId: ongoing.id };

test("cold entry opens the last in-progress mogi with the list behind it", () => {
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state }, { type: "load", sizeClass: "compact" }), {
    mogiId: "ongoing",
    operations: [
      { type: "replace", url: "/", pushed: false },
      { type: "push", url: "/?mogi=ongoing", pushed: true },
    ],
  });
});

test("regular entry opens the last in-progress mogi by replacing the list", () => {
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state }, { type: "load", sizeClass: "regular" }), {
    mogiId: "ongoing",
    operations: [{ type: "replace", url: "/?mogi=ongoing", pushed: false }],
  });
});

test("compact uses no fallback when the active mogi is not in progress", () => {
  const complete: Mogi = {
    ...ongoing,
    id: "finished",
    races: Array.from({ length: 12 }, (_, index) => ({
      id: `r${index}`,
      number: index + 1,
      origin: "manual",
      placements: ongoing.participants.map((person) => person.id),
    })),
  };
  for (const activeMogiId of [null, "missing", complete.id]) {
    const saved = { ...state, activeMogiId, mogis: [ongoing, complete] };
    assert.deepEqual(
      decideMogiRoute({ url: "/", pushed: false, state: saved }, { type: "load", sizeClass: "compact" }),
      {
        mogiId: null,
        operations: [],
      },
    );
  }
});

test("regular entry stays on the list with only finished mogis", () => {
  const complete: Mogi = {
    ...ongoing,
    races: Array.from({ length: 12 }, (_, index) => ({
      id: `r${index}`,
      number: index + 1,
      origin: "manual",
      placements: ongoing.participants.map((person) => person.id),
    })),
  };
  assert.deepEqual(
    decideMogiRoute(
      { url: "/", pushed: false, state: { ...state, mogis: [complete] } },
      { type: "load", sizeClass: "regular" },
    ),
    {
      mogiId: null,
      operations: [],
    },
  );
});

test("without an active in-progress mogi, regular opens the most recently created one", () => {
  const newest = { ...ongoing, id: "newest", createdAt: "2026-10-30" };
  const middle = { ...ongoing, id: "middle", createdAt: "2026-10-29" };
  const complete: Mogi = {
    ...ongoing,
    id: "finished",
    createdAt: "2026-10-31",
    races: Array.from({ length: 12 }, (_, index) => ({
      id: `r${index}`,
      number: index + 1,
      origin: "manual",
      placements: ongoing.participants.map((person) => person.id),
    })),
  };
  for (const activeMogiId of [null, "missing", complete.id]) {
    const saved = { ...state, activeMogiId, mogis: [ongoing, complete, newest, middle] };
    assert.deepEqual(
      decideMogiRoute({ url: "/", pushed: false, state: saved }, { type: "load", sizeClass: "regular" }),
      {
        mogiId: "newest",
        operations: [{ type: "replace", url: "/?mogi=newest", pushed: false }],
      },
    );
  }
});

test("links and popstate follow the URL without reopening the last mogi or writing history", () => {
  const other = { ...ongoing, id: "other" };
  const saved = { ...state, mogis: [ongoing, other] };
  for (const type of ["load", "pop"] as const) {
    assert.deepEqual(
      decideMogiRoute(
        { url: "/?mogi=other", pushed: false, state: saved },
        type === "load" ? { type, sizeClass: "regular" } : { type },
      ),
      {
        mogiId: "other",
        operations: [],
      },
    );
  }
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state }, { type: "pop" }), {
    mogiId: null,
    operations: [],
  });
});

test("a missing or empty id leads to the list with a notice, including in history", () => {
  for (const type of ["load", "pop"] as const) {
    for (const url of ["/?mogi=missing", "/?mogi="]) {
      assert.deepEqual(
        decideMogiRoute({ url, pushed: true, state }, type === "load" ? { type, sizeClass: "regular" } : { type }),
        {
          mogiId: null,
          operations: [{ type: "replace", url: "/", pushed: false }],
          toast: "Mogi not found",
        },
      );
    }
  }
});

test("opening from the list pushes; switching through the sidebar replaces and keeps the previous marker", () => {
  const id = "another / mogi";
  const saved = { ...state, mogis: [...state.mogis, { ...ongoing, id }] };
  for (const [url, pushed, operation] of [
    ["/", false, { type: "push", url: "/?mogi=another%20%2F%20mogi", pushed: true }],
    ["/?mogi=ongoing", true, { type: "replace", url: "/?mogi=another%20%2F%20mogi", pushed: true }],
    ["/?mogi=ongoing", false, { type: "replace", url: "/?mogi=another%20%2F%20mogi", pushed: false }],
  ] as const) {
    assert.deepEqual(decideMogiRoute({ url, pushed, state: saved }, { type: "open", id }), {
      mogiId: id,
      operations: [operation],
    });
  }
});

test("switching through the floating or docked sidebar keeps one Back to the list", () => {
  const saved = { ...state, mogis: [ongoing, { ...ongoing, id: "other" }] };
  const opened = decideMogiRoute({ url: "/", pushed: false, state: saved }, { type: "open", id: "ongoing" });
  assert.deepEqual(opened.operations, [{ type: "push", url: "/?mogi=ongoing", pushed: true }]);
  const switched = decideMogiRoute(
    { url: "/?mogi=ongoing", pushed: true, state: saved },
    { type: "open", id: "other" },
  );
  assert.deepEqual(switched.operations, [{ type: "replace", url: "/?mogi=other", pushed: true }]);
  assert.deepEqual(decideMogiRoute({ url: "/?mogi=other", pushed: true, state: saved }, { type: "back" }).operations, [
    { type: "back" },
  ]);
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state: saved }, { type: "pop" }), {
    mogiId: null,
    operations: [],
  });
});

test("Tracks and Instructions are destinations beside the mogis: one Back to the list, and the sidebar switches in place", () => {
  const opened = decideMogiRoute({ url: "/", pushed: false, state }, { type: "view", view: "tracks" });
  assert.deepEqual(opened, {
    mogiId: null,
    view: "tracks",
    operations: [{ type: "push", url: "/?view=tracks", pushed: true }],
  });
  assert.deepEqual(
    decideMogiRoute({ url: "/?view=tracks", pushed: false, state }, { type: "load", sizeClass: "regular" }),
    {
      mogiId: null,
      view: "tracks",
      operations: [],
    },
  );
  assert.deepEqual(
    decideMogiRoute({ url: "/?mogi=ongoing", pushed: true, state }, { type: "view", view: "tracks" }).operations,
    [{ type: "replace", url: "/?view=tracks", pushed: true }],
  );
  assert.deepEqual(
    decideMogiRoute({ url: "/?view=tracks", pushed: true, state }, { type: "view", view: "instructions" }).operations,
    [{ type: "replace", url: "/?view=instructions", pushed: true }],
  );
  assert.deepEqual(
    decideMogiRoute({ url: "/?view=tracks", pushed: true, state }, { type: "open", id: "ongoing" }).operations,
    [{ type: "replace", url: "/?mogi=ongoing", pushed: true }],
  );
  assert.deepEqual(decideMogiRoute({ url: "/?view=tracks", pushed: true, state }, { type: "back" }).operations, [
    { type: "back" },
  ]);
});

test("with no mogis, opening lands on Instructions: over the list on compact, in its place on regular", () => {
  const empty = { ...state, mogis: [], activeMogiId: null };
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state: empty }, { type: "load", sizeClass: "compact" }), {
    mogiId: null,
    view: "instructions",
    operations: [
      { type: "replace", url: "/", pushed: false },
      { type: "push", url: "/?view=instructions", pushed: true },
    ],
  });
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state: empty }, { type: "load", sizeClass: "regular" }), {
    mogiId: null,
    view: "instructions",
    operations: [{ type: "replace", url: "/?view=instructions", pushed: false }],
  });
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: true, state: empty }, { type: "pop" }), {
    mogiId: null,
    operations: [],
  });
});

test("Back uses marked history and replaces with the list without a marker", () => {
  assert.deepEqual(decideMogiRoute({ url: "/?mogi=ongoing", pushed: true, state }, { type: "back" }), {
    mogiId: "ongoing",
    operations: [{ type: "back" }],
  });
  assert.deepEqual(decideMogiRoute({ url: "/?mogi=ongoing", pushed: false, state }, { type: "back" }), {
    mogiId: null,
    operations: [{ type: "replace", url: "/", pushed: false }],
  });
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state }, { type: "back" }), {
    mogiId: null,
    operations: [],
  });
});

test("opening a mogi that no longer exists also returns to the list with a notice", () => {
  assert.deepEqual(decideMogiRoute({ url: "/", pushed: false, state }, { type: "open", id: "deleted" }), {
    mogiId: null,
    operations: [{ type: "replace", url: "/", pushed: false }],
    toast: "Mogi not found",
  });
});

test("deleting the open mogi goes back in compact and replaces with the list in other classes", () => {
  const deleted = { ...state, mogis: [], activeMogiId: null };
  for (const sizeClass of ["compact", "regular"] as const) {
    for (const pushed of [false, true]) {
      assert.deepEqual(
        decideMogiRoute({ url: "/?mogi=ongoing", pushed, state: deleted }, { type: "delete", sizeClass }),
        {
          mogiId: null,
          operations:
            sizeClass === "compact" && pushed
              ? [{ type: "replace", url: "/", pushed: false }, { type: "back" }]
              : [{ type: "replace", url: "/", pushed: false }],
          toast: "Mogi deleted",
        },
      );
    }
  }
});
