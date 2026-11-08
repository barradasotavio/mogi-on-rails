import assert from "node:assert/strict";
import { test } from "node:test";

import { listenForTrackpadPaging, springFrames } from "../components/ui/paging.ts";

test("a settle never passes its target", () => {
  // A very fast flick, a slow release, a release away, from rest, and a rubber band back from an end.
  for (const [from, to, velocity] of [
    [-200, -400, -5],
    [-200, -400, -0.2],
    [-200, -400, 1],
    [-200, -400, 0],
    [40, 0, 0],
  ] as const) {
    const { frames } = springFrames(from, to, velocity);
    assert.ok(
      frames.every((x) => (x - to) * (from - to) >= 0),
      `${from} → ${to} at ${velocity}`,
    );
    assert.equal(frames.at(-1), to);
  }
});

/** One two-finger swipe recorded on a MacBook trackpad in Chromium, as ms:deltaX. Its momentum carries late events
 * that Chromium merged: 43 px after 12 ms, and 18 px after a 49 ms gap where the tail was at 3 px a frame. */
const MAC_SWIPE = [
  "0:1 8:8 18:12 25:14 35:21 41:30 51:34 60:19 62:48 76:55 84:56 90:55 100:56 107:53 115:53 125:50 132:50",
  "141:50 148:47 156:46 167:45 173:45 184:43 190:43 198:40 207:40 215:38 220:38 234:36 240:34 250:34",
  "256:32 267:32 273:30 281:29 289:28 298:28 306:27 314:26 320:25 332:23 341:23 353:43 366:21 373:19",
  "381:19 392:18 397:17 405:17 415:17 422:15 431:15 439:13 447:13 459:13 465:12 472:11 481:11 490:11",
  "500:11 507:10 515:10 523:9 531:9 542:8 548:8 556:8 565:8 575:7 578:7 591:7 598:7 609:6 611:6 625:5",
  "632:5 640:5 648:5 656:4 667:4 670:4 683:4 690:4 699:4 706:3 715:3 720:3 769:18 782:3 789:3 800:2 808:2",
  "817:2 825:2 833:2 842:2 850:2 859:2 867:2 874:2 881:2 890:2 906:3 921:2 938:2 955:2 971:2 988:1 1005:1",
  "1021:1 1038:1 1055:1 1071:1 1105:1 1138:1 1171:1 1238:1",
]
  .join(" ")
  .split(" ")
  .map((event) => event.split(":").map(Number));

test("a Mac swipe's momentum turns one page and never starts another drag", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let wheel: (event: unknown) => void = () => {};
  class Node {}
  const globals = globalThis as Record<string, unknown>;
  globals.Node = Node;
  globals.Element = class {};
  globals.WheelEvent = { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };
  globals.window = {
    setTimeout,
    addEventListener: (_: string, listener: typeof wheel) => (wheel = listener),
    removeEventListener: () => {},
  };
  const element = Object.assign(new Node(), { contains: () => true, clientWidth: 400 });
  const calls: string[] = [];
  const stop = listenForTrackpadPaging(element as unknown as HTMLElement, {
    onTrack: () => calls.push("track"),
    onRelease: () => calls.push("release"),
  });
  let now = 0;
  for (const [time, deltaX] of MAC_SWIPE) {
    t.mock.timers.tick(time - now);
    now = time;
    wheel({ deltaX, deltaY: 0, deltaMode: 0, ctrlKey: false, timeStamp: time, target: element, preventDefault() {} });
  }
  t.mock.timers.tick(1000);
  stop();
  assert.deepEqual(calls.slice(calls.indexOf("release")), ["release"]);
});
