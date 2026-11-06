/**
 * Sideways paging shared by the sheets that page among siblings and by the capture viewer: a two-finger
 * horizontal swipe on a trackpad, and ← / → on the keyboard. Both are shortcuts for visible controls.
 */

/** Least travel of one trackpad swipe, in pixels, before it turns the page; wider pagers ask for a fifth of their width. */
const WHEEL_THRESHOLD = 60;
/** A pause this long ends the swipe, so its momentum never turns a second page. */
const WHEEL_SETTLE_MS = 180;

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
  /** Turns one page (1 forward, -1 back); false when there is none that way. */
  onStep: (step: 1 | -1) => boolean | void;
  /** The swipe's travel so far, in pixels (positive toward the next page), so the page can follow the fingers. */
  onTrack?: (travel: number) => void;
  /** The swipe ended without turning a page: the page springs back. */
  onCancel?: () => void;
  /** Whether the pager takes the gesture at all, such as at 1× in the viewer. */
  canPage?: () => boolean;
};

/**
 * Turns a horizontal trackpad swipe into one page step, as Safari and Photos do: the page follows the deltas,
 * turns once the travel passes the threshold and springs back otherwise. The listener is on the window and not
 * passive: it takes every horizontal wheel event it owns, so the browser's own back/forward swipe never starts.
 * Wheel events have no phases on the web, so a pause ends the swipe and its momentum turns no second page.
 */
export function listenForTrackpadPaging(
  element: HTMLElement,
  { onStep, onTrack, onCancel, canPage = () => true }: TrackpadPaging,
) {
  let travel = 0,
    turned = false,
    timer = 0;
  const settle = () => {
    if (!turned && travel) onCancel?.();
    travel = 0;
    turned = false;
  };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || !canPage()) return;
    if (!ownsWheel(element, event.target)) return;
    if (element.contains(event.target as Node) && scrollsSideways(event.target, element, event.deltaX)) return;
    event.preventDefault();
    clearTimeout(timer);
    timer = window.setTimeout(settle, WHEEL_SETTLE_MS);
    if (turned) return;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? element.clientWidth
          : 1;
    travel += event.deltaX * unit;
    if (Math.abs(travel) < Math.max(WHEEL_THRESHOLD, element.clientWidth / 5)) {
      onTrack?.(travel);
      return;
    }
    turned = true;
    if (onStep(travel > 0 ? 1 : -1) === false) onCancel?.();
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
