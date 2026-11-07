/**
 * Sideways paging shared by the sheets that page among siblings and by the capture viewer: a two-finger
 * horizontal swipe on a trackpad, and ← / → on the keyboard. Both are shortcuts for visible controls.
 */

/** Least travel of one trackpad swipe, in pixels, before it turns the page; wider pagers ask for a fifth of their width. */
const WHEEL_THRESHOLD = 60;
/** A pause this long means the fingers lifted: the drag is released. */
const WHEEL_RELEASE_MS = 70;
/** A pause this long ends the swipe and its momentum. */
const WHEEL_SETTLE_MS = 180;
/** Deltas falling this many events in a row, under this share of the swipe's peak, are momentum: the fingers lifted. */
const WHEEL_DECAY_EVENTS = 3;
const WHEEL_DECAY_SHARE = 0.6;
/** Momentum only decays: a delta past twice its lowest since it began falling, plus this jitter, is a new swipe. */
const WHEEL_RISE_PX = 4;

/** A released drag settles where it would be this long later at its speed, as in UIScrollView. */
const PROJECTION_MS = 200;
/** A release faster than this, in px/ms, turns the page whatever the travel. */
const FLICK_SPEED = 0.5;
/** Speed is measured over the last samples of this span. */
const VELOCITY_MS = 64;
const STIFFNESS = 300;
const DAMPING = 30;

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
 * A spring from `from` to `to` that starts at the release's `velocity` (px/ms), so the motion carries on from the
 * gesture: one offset a frame, for linear keyframes, and their duration in ms.
 */
export function springFrames(from: number, to: number, velocity: number) {
  const frames = [from];
  let offset = from - to,
    speed = velocity * 1000;
  while (frames.length < 60 && (Math.abs(offset) > 0.5 || Math.abs(speed) > 20)) {
    for (let ms = 0; ms < 16; ms++) {
      speed += (-STIFFNESS * offset - DAMPING * speed) / 1000;
      offset += speed / 1000;
    }
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
  /** Without `onRelease`: turns one page (1 forward, -1 back) once the swipe passes the threshold. */
  onStep?: (step: 1 | -1) => void;
  /** The swipe's travel so far, in pixels (positive toward the next page), so the page can follow the fingers. */
  onTrack?: (travel: number) => void;
  /** The fingers lifted, with the swipe's travel and speed (px/ms): the page settles one way or the other. */
  onRelease?: (travel: number, velocity: number) => void;
  /** Whether the pager takes the gesture at all, such as at 1× in the viewer. */
  canPage?: () => boolean;
};

/**
 * Follows a horizontal trackpad swipe, as Safari and Photos do. The listener is on the window and not passive: it
 * takes every horizontal wheel event it owns, so the browser's own back/forward swipe never starts.
 * Wheel events have no phases on the web, so the fingers lift when the deltas start decaying or pause, and the swipe
 * ends with a longer pause or deltas that rise again: its momentum turns no second page, and the next swipe pages
 * even while that momentum still flows.
 */
export function listenForTrackpadPaging(
  element: HTMLElement,
  { onStep, onTrack, onRelease, canPage = () => true }: TrackpadPaging,
) {
  let phase: "idle" | "drag" | "momentum" = "idle",
    travel = 0,
    peak = 0,
    falls = 0,
    last = 0,
    trough = Infinity,
    timer = 0,
    samples: { time: number; travel: number }[] = [];
  const end = () => {
    phase = "idle";
  };
  const release = (now: number) => {
    phase = "momentum";
    trough = last;
    onRelease?.(travel, dragVelocity(samples, now));
  };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || !canPage()) return;
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
      size = Math.abs(delta);
    clearTimeout(timer);
    if (phase === "momentum") {
      if (size < 2 * trough + WHEEL_RISE_PX) {
        if (size < last) trough = Math.min(trough, size);
        last = size;
        timer = window.setTimeout(end, WHEEL_SETTLE_MS);
        return;
      }
      phase = "idle";
    }
    if (phase === "idle") {
      phase = "drag";
      travel = peak = falls = last = 0;
      samples = [];
    }
    travel += delta;
    samples = [...samples.slice(-7), { time: event.timeStamp, travel }];
    falls = size < last ? falls + 1 : 0;
    last = size;
    peak = Math.max(peak, size);
    if (!onRelease) {
      timer = window.setTimeout(end, WHEEL_SETTLE_MS);
      if (Math.abs(travel) < Math.max(WHEEL_THRESHOLD, element.clientWidth / 5)) return onTrack?.(travel);
      phase = "momentum";
      trough = Infinity;
      onStep?.(travel > 0 ? 1 : -1);
      return;
    }
    onTrack?.(travel);
    if (falls >= WHEEL_DECAY_EVENTS && size < peak * WHEEL_DECAY_SHARE) {
      release(event.timeStamp);
      timer = window.setTimeout(end, WHEEL_SETTLE_MS);
    } else
      timer = window.setTimeout(() => {
        release(performance.now());
        timer = window.setTimeout(end, WHEEL_SETTLE_MS - WHEEL_RELEASE_MS);
      }, WHEEL_RELEASE_MS);
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
