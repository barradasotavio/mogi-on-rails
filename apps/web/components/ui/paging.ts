/**
 * Sideways paging shared by the sheets that page among siblings and by the capture viewer: a two-finger
 * horizontal swipe on a trackpad or a mouse's horizontal wheel, and ← / → on the keyboard. All are shortcuts for
 * visible controls.
 */

/** Least travel of one wheel gesture, in pixels, before it turns the page; wider pagers ask for a fifth of their width. */
const WHEEL_THRESHOLD = 60;
/** A pause this long ends the gesture and its momentum. */
const WHEEL_SETTLE_MS = 180;
/** A new swipe stops the momentum, as the fingers touch the trackpad: a pause (below), or the pace down to this many
 * pixels a frame, then rising again past twice its lowest plus this jitter. Before that, a rise is the fingers still
 * speeding up, or late events merged while the page turns. */
const WHEEL_REST_PX = 4;
const WHEEL_RISE_PX = 4;
/** Fingers touching the trackpad cut the momentum at once: its events, one a frame, pause this long, and the next
 * delta is the new swipe's, under half the travel the momentum would have covered meanwhile. A busy page pauses them
 * too, but then delivers that travel merged into one big delta. */
const WHEEL_TOUCH_MS = 30;
/** Momentum is compared as the travel of the last few frames of a 120 Hz trackpad, per frame: a busy page gets late
 * events merged into one bigger delta, or one frame's travel split in two events. */
const WHEEL_FRAME_MS = 8;
const WHEEL_PACE_MS = 3 * WHEEL_FRAME_MS;

/** A released drag settles where it would be this long later at its speed, as in UIScrollView. */
const PROJECTION_MS = 200;
/** A release faster than this, in px/ms, turns the page whatever the travel. */
const FLICK_SPEED = 0.5;
/** Speed is measured over the last samples of this span. */
const VELOCITY_MS = 64;
/** A settle is a critically damped spring, as iOS paging and SwiftUI's `.smooth`: no bounce, about this long. */
const RESPONSE_MS = 400;

/** Speed of a drag in px/ms at `now`, from its samples of time and travel, oldest first. */
export function dragVelocity(samples: { time: number; travel: number }[], now: number) {
  const last = samples.at(-1);
  const base = samples.findLast((sample) => sample.time <= now - VELOCITY_MS) ?? samples[0];
  return last && base && now > base.time ? (last.travel - base.travel) / (now - base.time) : 0;
}

/** Where a released drag settles: 1 on the next page, -1 on the previous one, 0 back in place. */
export function settleSide(travel: number, velocity: number, width: number): 1 | -1 | 0 {
  const projected = travel + velocity * PROJECTION_MS;
  if (travel > 0 && (projected > width / 2 || velocity > FLICK_SPEED)) return 1;
  if (travel < 0 && (projected < -width / 2 || velocity < -FLICK_SPEED)) return -1;
  return 0;
}

/** Past an end the page resists more the farther it goes, as in iOS. */
export function rubberBand(offset: number, width: number) {
  return Math.sign(offset) * (1 - 1 / ((Math.abs(offset) * 0.55) / width + 1)) * width;
}

/**
 * A critically damped spring from `from` to `to` that starts at the release's `velocity` (px/ms), so the motion
 * carries on from the gesture: one offset a frame, for linear keyframes, and their duration in ms.
 * It never passes `to`: a release toward it faster than the spring would cross stiffens the spring instead, so the
 * page keeps the flick's speed and decays into place. A release away from it slows, then returns.
 */
export function springFrames(from: number, to: number, velocity: number) {
  const x0 = from - to,
    toward = x0 * velocity < 0 ? Math.abs(velocity / x0) : 0,
    omega = Math.max((2 * Math.PI) / RESPONSE_MS, toward),
    c = velocity + omega * x0,
    frames = [from];
  for (let t = 16; frames.length < 60; t += 16) {
    const decay = Math.exp(-omega * t),
      offset = (x0 + c * t) * decay,
      speed = (velocity - omega * c * t) * decay;
    if (Math.abs(offset) < 0.5 && Math.abs(speed) < 0.02) break;
    frames.push(to + offset);
  }
  frames.push(to);
  return { frames, duration: (frames.length - 1) * 16 };
}

/** Whether an element between the target and the pager can still scroll that way: then the wheel scrolls it. */
function scrollsSideways(target: EventTarget | null, root: Element, deltaX: number) {
  for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth) continue;
    const overflow = getComputedStyle(node).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (deltaX < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
  }
  return false;
}

const DIALOGS = "[role=dialog]:not([data-state=closed]), [role=alertdialog]:not([data-state=closed])";

/**
 * Whether a wheel event belongs to the pager on `element`: over it, or over the dimmed page beside it while it is
 * the topmost dialog. The pointer often rests where the tile was tapped, beside the sheet, and the swipe must not wait
 * for it to move.
 */
function ownsWheel(element: HTMLElement, target: EventTarget | null) {
  if (target instanceof Node && element.contains(target)) return true;
  if (target instanceof Element && target.closest(DIALOGS)) return false;
  const top = [...document.querySelectorAll(DIALOGS)].at(-1);
  return !!top && (top === element || element.contains(top) || top.contains(element));
}

export type TrackpadPaging = {
  /** Turns one page, 1 forward or -1 back. */
  onStep: (step: 1 | -1) => void;
  /** Whether the pager takes the gesture at all, such as at 1× in the viewer. */
  canPage?: () => boolean;
};

/**
 * Turns one page per sideways wheel gesture: a two-finger trackpad swipe, or a mouse's horizontal wheel. The gesture is
 * a command, as ← and → are: the page turns with their slide once the travel passes the threshold, and doesn't follow
 * the fingers. Wheel events on the web never say when the fingers lift, so following them would mean guessing where
 * the fingers end and the momentum begins.
 * The listener is on the window and not passive: it takes every sideways wheel event it owns, so the browser's own
 * back/forward swipe never starts. The gesture's momentum turns no second page, and the next swipe pages even while
 * that momentum still flows. A vertical event cancels a gesture that hasn't paged yet, so a scroll never pages.
 */
export function listenForTrackpadPaging(element: HTMLElement, { onStep, canPage = () => true }: TrackpadPaging) {
  let phase: "idle" | "travel" | "momentum" = "idle",
    travel = 0,
    trough = Infinity,
    recent: { time: number; size: number }[] = [],
    pace = 0,
    lastTime = -Infinity,
    timer = 0;
  const end = () => {
    phase = "idle";
  };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || !canPage()) return;
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      // A scroll cancels a swipe that hasn't paged; a swipe's momentum that curves vertical still holds the next one.
      if (phase === "travel" && event.deltaY) phase = "idle";
      if (phase === "momentum") {
        clearTimeout(timer);
        timer = window.setTimeout(end, WHEEL_SETTLE_MS);
      }
      return;
    }
    if (!ownsWheel(element, event.target)) return;
    if (element.contains(event.target as Node) && scrollsSideways(event.target, element, event.deltaX)) return;
    event.preventDefault();
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? element.clientWidth
          : 1;
    const delta = event.deltaX * unit,
      gap = event.timeStamp - lastTime,
      touched = gap >= WHEEL_TOUCH_MS && Math.abs(delta) < (pace * gap) / WHEEL_FRAME_MS / 2;
    lastTime = event.timeStamp;
    recent = [
      ...recent.filter(({ time }) => time > event.timeStamp - WHEEL_PACE_MS),
      { time: event.timeStamp, size: Math.abs(delta) },
    ];
    pace = recent.reduce((sum, { size }) => sum + size, 0) / (WHEEL_PACE_MS / WHEEL_FRAME_MS);
    clearTimeout(timer);
    timer = window.setTimeout(end, WHEEL_SETTLE_MS);
    if (phase === "momentum") {
      if (pace <= WHEEL_REST_PX) trough = Math.min(trough, pace);
      if (!touched && pace < 2 * trough + WHEEL_RISE_PX) return;
      phase = "idle";
    }
    if (phase === "idle") {
      phase = "travel";
      travel = 0;
    }
    travel += delta;
    if (Math.abs(travel) < Math.max(WHEEL_THRESHOLD, element.clientWidth / 5)) return;
    phase = "momentum";
    trough = Infinity;
    onStep(travel > 0 ? 1 : -1);
  };
  window.addEventListener("wheel", wheel, { passive: false });
  return () => {
    clearTimeout(timer);
    window.removeEventListener("wheel", wheel);
  };
}

/** ← and → page, except where the arrows already mean something: text fields, sliders and radio groups. */
export function keyboardPageStep(event: {
  key: string;
  target: EventTarget | null;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): 1 | -1 | 0 {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return 0;
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return 0;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='slider'], [role='radiogroup'], [role='radio'], [role='tablist']",
    )
  )
    return 0;
  return event.key === "ArrowLeft" ? -1 : 1;
}
