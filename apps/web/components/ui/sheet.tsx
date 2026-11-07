"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Drawer as Vaul } from "vaul";

import { ActionErrorText, useActionScope } from "@/components/ui/action-error";
import { GlassButton, ToolbarGroup } from "@/components/ui/glass-button";
import { ListMaterial } from "@/components/ui/list";
import {
  dragVelocity,
  keyboardPageStep,
  listenForTrackpadPaging,
  rubberBand,
  settleSide,
  springFrames,
} from "@/components/ui/paging";
import { currentSizeClass } from "@/components/ui/size-class";
import { useUpdateBlock } from "@/components/ui/update-activity";
import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * Surface for details, tasks and menus, adapted to the size class (HIG, Sheets and Inspectors).
 * - compact (below 768px): bottom sheet on Vaul, large (`full`/`fit`) or, for `menu`, medium and in glass.
 * - regular: `detail` floats as an inspector on the right, over the content, at every width; `modal` and
 *   `menu` are a centered dialog. Radix supplies focus trap, focus return and Escape, and keeps the
 *   surface mounted until its exit animation ends.
 * The presentation is chosen when the sheet opens and kept until it closes, so drafts survive rotation.
 */
export type SheetKind = "detail" | "modal" | "menu";
type Height = "full" | "fit";

const SheetContext = createContext<{ compact: boolean; kind: SheetKind }>({ compact: false, kind: "detail" });

export function SheetRoot({
  open,
  onOpenChange,
  kind = "detail",
  blocksUpdates = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: SheetKind;
  blocksUpdates?: boolean;
  children: ReactNode;
}) {
  useUpdateBlock(open && blocksUpdates);
  const [session, setSession] = useState({ open: false, compact: false });
  if (open !== session.open) {
    setSession({ open, compact: open ? currentSizeClass() === "compact" : session.compact });
  }
  return (
    <SheetContext.Provider value={{ compact: session.compact, kind }}>
      <ListMaterial.Provider value={session.compact && kind === "menu" ? "glass" : "plain"}>
        {session.compact ? (
          // Vaul only moves focus into the drawer with autoFocus; initial focus goes to the close control.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          <Vaul.Root open={open} onOpenChange={onOpenChange} autoFocus>
            {children}
          </Vaul.Root>
        ) : (
          <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            {children}
          </DialogPrimitive.Root>
        )}
      </ListMaterial.Provider>
    </SheetContext.Provider>
  );
}

type SurfaceProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, "children"> & {
  height?: Height;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/** The surface clips without becoming a scroll container through focus; only the content scrolls. */
export function SheetSurface({
  height = "full",
  initialFocus,
  onOpenAutoFocus,
  onInteractOutside,
  className,
  children,
  ...props
}: SurfaceProps) {
  const { compact, kind } = useContext(SheetContext);
  // Touching or swiping the toast is not a tap outside: the sheet stays open.
  const outside: SurfaceProps["onInteractOutside"] = (event) => {
    onInteractOutside?.(event);
    if (event.target instanceof Element && event.target.closest("[data-toast]")) event.preventDefault();
  };
  // Focus goes to the close control, so opening a consultation never summons the keyboard.
  const focus: SurfaceProps["onOpenAutoFocus"] = (event) => {
    onOpenAutoFocus?.(event);
    if (!event.defaultPrevented && initialFocus?.current) {
      event.preventDefault();
      initialFocus.current.focus();
    }
  };
  if (compact) {
    const medium = kind === "menu";
    return (
      <Vaul.Portal>
        {/* Glass samples what is behind it: the medium sheet sits on a clear overlay, the opaque one on the scrim. */}
        <Vaul.Overlay className={cn("fixed inset-0 z-50", !medium && "scrim")} />
        <Vaul.Content
          onOpenAutoFocus={focus}
          onInteractOutside={outside}
          {...props}
          className={cn(
            "fixed z-50 flex flex-col overflow-clip text-popover-foreground outline-none",
            medium
              ? "glass sheet-medium inset-x-2 rounded-4xl"
              : cn("inset-x-0 bottom-0 rounded-t-3xl bg-popover", height === "fit" ? "sheet-fit" : "sheet-full"),
            className,
          )}
        >
          {children}
        </Vaul.Content>
      </Vaul.Portal>
    );
  }
  const fade =
    "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200";
  if (kind === "detail") {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("scrim fixed inset-0 z-40", fade)} />
        <DialogPrimitive.Content
          onOpenAutoFocus={focus}
          onInteractOutside={outside}
          {...props}
          className={cn(
            "inspector-inset fixed right-2 z-50 flex w-100 flex-col overflow-clip rounded-3xl bg-popover text-popover-foreground shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-8 data-[state=closed]:duration-200",
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  }
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn("scrim fixed inset-0 z-50", fade)} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
        <DialogPrimitive.Content
          onOpenAutoFocus={focus}
          onInteractOutside={outside}
          {...props}
          className={cn(
            "pointer-events-auto relative flex max-h-full w-full max-w-lg flex-col overflow-clip rounded-4xl bg-popover text-popover-foreground shadow-2xl outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200",
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

/** `bar` is the centered title of the floating bar; `heading` is a visible title inside the content. */
export function SheetTitle({
  variant = "heading",
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Title>, "className"> & { variant?: "bar" | "heading" }) {
  const { compact } = useContext(SheetContext);
  const className =
    variant === "bar" ? "block min-w-0 flex-1 truncate text-center text-base font-semibold" : "text-lg font-semibold";
  return compact ? (
    <Vaul.Title className={className} {...props} />
  ) : (
    <DialogPrimitive.Title className={className} {...props} />
  );
}

export function SheetDescription({
  hidden = false,
  variant,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Description>, "className" | "hidden"> & {
  hidden?: boolean;
  variant?: "bar";
}) {
  const { compact } = useContext(SheetContext);
  const className = hidden
    ? "sr-only"
    : variant === "bar"
      ? "block truncate text-center text-xs text-muted-foreground"
      : "text-sm text-muted-foreground";
  return compact ? (
    <Vaul.Description className={className} {...props} />
  ) : (
    <DialogPrimitive.Description className={className} {...props} />
  );
}

export function SheetClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  const { compact } = useContext(SheetContext);
  return compact ? <Vaul.Close {...props} /> : <DialogPrimitive.Close {...props} />;
}

/** Whether the open sheet is a bottom drawer; the content adapts its spacing to it. */
export const useSheetCompact = () => useContext(SheetContext).compact;

/**
 * Full sheet: floating title and corner control, optional search, page stack and floating
 * footer. Opening a page (a new `page` key with `onBack`) swaps Close for Back, slides the new
 * page in and starts at the top. Escape closes the sheet from any page.
 */
export function Sheet({
  open,
  onOpenChange,
  onCloseAutoFocus,
  initialFocus,
  kind = "detail",
  title,
  subtitle,
  description,
  page = "",
  onBack,
  pager,
  footer,
  search,
  height = "full",
  bleed = false,
  closeLabel = "Close",
  blocksUpdates = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind?: SheetKind;
  title: ReactNode;
  description?: ReactNode;
  /** A short status under the bar title, such as "Edit in progress"; it is also the sheet's description. */
  subtitle?: string;
  /**
   * A controlled opening (no Radix trigger) restores focus to its initiator here. In a panel-to-panel handoff
   * the closing panel skips its return, so the destination owns focus.
   */
  onCloseAutoFocus?: SurfaceProps["onCloseAutoFocus"];
  initialFocus?: SurfaceProps["initialFocus"];
  page?: string;
  onBack?: () => void;
  footer?: ReactNode;
  search?: ReactNode;
  height?: Height;
  bleed?: boolean;
  closeLabel?: string;
  children: ReactNode;
  blocksUpdates?: boolean;
  /** Paging among the siblings of what opened the sheet; give each sibling its own `page`. A nested page passes none. */
  pager?: SheetPager;
}) {
  // A page drawn by a component inside the content takes over the title, Back and footer.
  const [inner, setInner] = useState<InnerPage | null>(null);
  const innerBack = useRef<(() => void) | undefined>(undefined);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  // Stable, so the sheets' many renders don't make React search their content for consumers.
  const [pages] = useState(() => ({
    show: setInner,
    setBack: (back?: () => void) => {
      innerBack.current = back;
    },
  }));
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange} kind={kind} blocksUpdates={blocksUpdates}>
      <SheetPages
        title={inner?.title ?? title}
        subtitle={inner ? undefined : subtitle}
        description={description}
        page={inner ? `${page}/${inner.page}` : page}
        base={page}
        depth={inner?.depth ?? 0}
        open={open}
        onBack={inner?.back ? () => innerBack.current?.() : onBack}
        pager={inner ? undefined : pager}
        onClose={() => onOpenChange(false)}
        footer={inner ? inner.footer ? <div ref={setFooterSlot} /> : undefined : footer}
        search={inner ? undefined : search}
        height={height}
        bleed={bleed}
        closeLabel={closeLabel}
        initialFocus={initialFocus}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <InnerPages.Provider value={pages}>
          <InnerFooter.Provider value={footerSlot}>{children}</InnerFooter.Provider>
        </InnerPages.Provider>
      </SheetPages>
    </SheetRoot>
  );
}

/**
 * Previous and next sibling, as in Mail and Photos: the chevrons in the bar, plus ← / →, a sideways swipe
 * and a two-finger trackpad swipe as shortcuts. An end has no function there, and its chevron is disabled.
 */
export type SheetPager = { previous?: () => void; next?: () => void; previousLabel: string; nextLabel: string };

type Side = 1 | -1 | 0;

/**
 * A sideways drag between pages, finger or trackpad. Once its way is known the pager turns there silently and a
 * frozen copy of the page it started on stays beside the new one, so both move with the drag; letting go springs
 * them to the side the drag favours, or turns back silently.
 */
type Drag = {
  /** Offset of the page the drag started on, in pixels; positive toward the previous page. */
  dx: number;
  width: number;
  /** The pager of the page the drag started on, and the way back to it from the neighbour once that is drawn. */
  origin?: SheetPager;
  back?: () => void;
  /** The page asked for (1 next, -1 previous, 0 the first) and the one drawn: they differ until React commits. */
  side: Side;
  drawn: Side;
  copy?: HTMLElement;
  top: number;
  scrollTop: number;
  /** Let go before the page asked for was drawn: settles once it is. */
  released?: { velocity: number; cancelled: boolean };
  /** A running settle; finishing it jumps to its end. */
  settle?: { animations: Animation[]; done: () => void };
  /** Settled back, waiting for the first page to be drawn again. */
  closing?: () => void;
};

const offsetOf = (drag: Drag) =>
  drag.side === 0 && !(drag.dx > 0 ? drag.origin?.previous : drag.origin?.next)
    ? rubberBand(drag.dx, drag.width)
    : drag.dx;

type InnerPage = { page: string; title: string; footer: boolean; back: boolean; depth: number };
const InnerPages = createContext<{ show: (page: InnerPage | null) => void; setBack: (back?: () => void) => void }>({
  show: () => {},
  setBack: () => {},
});
const InnerFooter = createContext<HTMLElement | null>(null);

/**
 * A page drawn by a component inside the sheet's content, such as Edit Result's place picker: while
 * mounted, its title, Back and footer replace the sheet's, and the page slides in like one of the stack.
 * Without `onBack`, Back stays the sheet's own. Returns the footer element, for a portal, once drawn.
 * `depth` orders the content's pages, so going to a shallower one slides like Back.
 * `{ page: null }` draws nothing, for a component that hands its page to a child.
 */
export function useSheetPage({
  page,
  title,
  footer,
  onBack,
  depth = 0,
}:
  | { page: string; title: string; footer: boolean; onBack?: () => void; depth?: number }
  | { page: null; title?: never; footer?: never; onBack?: never; depth?: never }) {
  const { show, setBack } = useContext(InnerPages);
  const slot = useContext(InnerFooter);
  useLayoutEffect(() => {
    setBack(onBack);
  });
  const back = !!onBack;
  useLayoutEffect(() => {
    if (page === null) return;
    show({ page, title, footer, back, depth });
    return () => show(null);
  }, [show, page, title, footer, back, depth]);
  return page !== null && footer ? slot : null;
}

function SheetPages({
  title,
  subtitle,
  description,
  page,
  base,
  depth,
  open,
  onBack,
  pager,
  onClose,
  onCloseAutoFocus,
  initialFocus,
  footer,
  search,
  height,
  bleed,
  closeLabel,
  children,
}: {
  title: ReactNode;
  subtitle?: string;
  description?: ReactNode;
  page: string;
  open: boolean;
  onBack?: () => void;
  pager?: SheetPager;
  onClose: () => void;
  footer?: ReactNode;
  search?: ReactNode;
  /** The sheet's own page: changing it remounts the content; an inner page only slides it. */
  base: string;
  /** Depth of the inner page within the content's own pages. */
  depth: number;
  height: Height;
  bleed: boolean;
  closeLabel: string;
  children: ReactNode;
  onCloseAutoFocus?: SurfaceProps["onCloseAutoFocus"];
  initialFocus?: SurfaceProps["initialFocus"];
}) {
  const compact = useSheetCompact();
  const { kind } = useContext(SheetContext);
  const corner = useRef<HTMLButtonElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // On iPhone the search moves down to the footer, within thumb reach and above the keyboard.
  const bottom = compact ? (search ?? footer) : footer;
  const top = compact ? undefined : search;
  const firstPage = useRef(page);
  const firstBase = useRef(base);
  const firstDepth = useRef(depth);
  const wasOpen = useRef(open);
  // Back, or a shallower inner page, slides the new page in from the leading edge.
  const goingBack = useRef(false);
  // A page change in the same frame as a slide, such as a page that opens on its first inner page, joins it.
  const settled = useRef(false);
  const frame = useRef(0);
  const content = useRef<HTMLDivElement>(null);
  // Failures of a control in this sheet appear at the end of its content, unless a finer ActionScope holds it.
  const scope = useActionScope();
  // Paging keeps focus where it was, on the chevron or in the content's place, and says which page came.
  const paged = useRef(false);
  const [announced, setAnnounced] = useState(false);
  // The portal mounts the surface a commit after the sheet opens, so the trackpad listener follows the element itself.
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const pagerRef = useRef(pager);
  const bar = useRef({ title, subtitle });
  useLayoutEffect(() => {
    pagerRef.current = pager;
    bar.current = { title, subtitle };
  });
  // While a drag shows two pages, the bar keeps the first one's title until the turn settles.
  const [frozen, setFrozen] = useState<{ title: ReactNode; subtitle?: string } | null>(null);
  const shown = frozen ?? { title, subtitle };
  const drag = useRef<Drag | null>(null);
  const finishSettle = () => {
    const settle = drag.current?.settle;
    settle?.animations.forEach((animation) => animation.cancel());
    settle?.done();
  };
  // Reads only refs, so the trackpad listener can keep the first one.
  const turn = (step: 1 | -1) => {
    finishSettle();
    const go = step < 0 ? pagerRef.current?.previous : pagerRef.current?.next;
    if (!go || drag.current) return false;
    paged.current = true;
    goingBack.current = step < 0;
    go();
    return true;
  };
  // The control that opened the page leaves with the previous one; focus goes to the corner, as in VoiceOver.
  // Paging keeps it, unless its chevron just became disabled at an end: then the other chevron takes it.
  const keepFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && active.disabled)
      corner.current
        ?.closest("[role=dialog]")
        ?.querySelector<HTMLButtonElement>("[data-pager] button:enabled")
        ?.focus({ preventScroll: true });
    else if (!active || active === document.body || !active.isConnected) corner.current?.focus({ preventScroll: true });
  };
  const place = (d: Drag) => {
    if (d.settle || d.closing) return;
    const x = offsetOf(d);
    content.current?.style.setProperty("translate", `${x + d.drawn * d.width}px 0`);
    d.copy?.style.setProperty("translate", `${x}px 0`);
    d.copy?.style.setProperty("visibility", d.drawn ? "visible" : "hidden");
  };
  /** Moves the pages to `dx`; past 8 px the neighbour that way, if any, comes in beside a copy of this page. */
  const dragTo = (dx: number) => {
    if (drag.current?.settle) finishSettle();
    const element = content.current,
      box = scroller.current;
    if (drag.current?.closing || !element || !box) return;
    const d = drag.current ?? {
      dx,
      width: box.clientWidth,
      origin: pagerRef.current,
      side: 0,
      drawn: 0,
      top: 0,
      scrollTop: 0,
    };
    drag.current = d;
    d.dx = dx;
    const way: Side = Math.abs(dx) < 8 ? d.side : dx < 0 ? 1 : -1;
    const go = way > 0 ? d.origin?.next : d.origin?.previous;
    if (way !== d.side && d.side === d.drawn) {
      if (d.side) {
        d.side = 0;
        d.back?.();
      } else if (go) {
        if (!d.copy) {
          const copy = element.cloneNode(true) as HTMLElement;
          for (const node of [copy, ...copy.querySelectorAll("[id]")]) node.removeAttribute("id");
          copy.setAttribute("aria-hidden", "true");
          copy.inert = true;
          copy.style.cssText = `position:absolute;top:${element.offsetTop}px;left:${element.offsetLeft}px;width:${element.offsetWidth}px;pointer-events:none`;
          box.append(copy);
          Object.assign(d, { copy, top: element.offsetTop, scrollTop: box.scrollTop });
        }
        setFrozen((current) => current ?? bar.current);
        d.side = way;
        go();
      }
    }
    place(d);
  };
  /** Letting go springs the pages to the side the drag favours, at its speed; turning back is silent too. */
  const release = (velocity: number, cancelled = false) => {
    const d = drag.current,
      element = content.current;
    if (!d || !element || d.settle || d.closing) return;
    if (d.side !== d.drawn) {
      d.released = { velocity, cancelled };
      return;
    }
    const to = !cancelled && d.side && settleSide(-d.dx, -velocity, d.width) === d.side ? d.side : 0;
    const from = offsetOf(d),
      target = -to * d.width,
      copy = d.copy;
    // Turning back, the first page is drawn again under the copy, which slides home over it.
    const back = !to && !!d.side;
    if (back) {
      d.side = 0;
      d.back?.();
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const done = () => {
      d.settle = undefined;
      if (d.side !== d.drawn) {
        d.closing = done;
        return;
      }
      copy?.remove();
      content.current?.style.removeProperty("translate");
      content.current?.style.removeProperty("visibility");
      drag.current = null;
      setFrozen(null);
      if (copy) keepFocus();
      if (!to) return;
      setAnnounced(true);
      if (reduced) content.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
    };
    if (reduced) return done();
    const { frames, duration } = springFrames(from, target, from === d.dx ? velocity : 0);
    const slide = (layer: HTMLElement, shift: number) => {
      layer.style.setProperty("translate", `${target + shift}px 0`);
      return layer.animate(
        frames.map((x) => ({ translate: `${x + shift}px 0` })),
        { duration, easing: "linear" },
      );
    };
    const animations = back ? [slide(copy!, 0)] : [slide(element, to * d.width)];
    if (back) element.style.setProperty("visibility", "hidden");
    else if (to) animations.push(slide(copy!, 0));
    animations[0].onfinish = done;
    d.settle = { animations, done };
  };
  const paging = !!pager;
  const gesture = useRef({ dragTo, release });
  useLayoutEffect(() => {
    gesture.current = { dragTo, release };
  });
  // Two fingers on a trackpad move the pages as one finger does on a phone: they follow, then settle.
  useEffect(() => {
    if (!paging || !surface) return;
    return listenForTrackpadPaging(surface, {
      onTrack: (travel) => gesture.current.dragTo(-travel),
      onRelease: (_, velocity) => gesture.current.release(-velocity),
    });
  }, [paging, surface]);
  // A finger dragging sideways moves the pages with it.
  const swipe = useRef<{
    pointer: number;
    x: number;
    y: number;
    horizontal: boolean | null;
    samples: { time: number; travel: number }[];
  } | null>(null);
  function swipeStart(event: PointerEvent<HTMLDivElement>) {
    // React events bubble out of portals: a dialog or viewer opened from the content isn't the sheet's page.
    if (
      !paging ||
      event.pointerType === "mouse" ||
      swipe.current ||
      !event.currentTarget.contains(event.target as Node)
    )
      return;
    swipe.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, horizontal: null, samples: [] };
  }
  function swipeMove(event: PointerEvent<HTMLDivElement>) {
    const current = swipe.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (current.horizontal === null) {
      if (Math.hypot(dx, dy) < 8) {
        event.stopPropagation();
        return;
      }
      current.horizontal = Math.abs(dx) > Math.abs(dy);
      // The page under the finger is replaced mid-drag: the scroller keeps the pointer.
      if (current.horizontal) event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!current.horizontal) return;
    // The drawer underneath must not take a sideways swipe for a drag down.
    event.stopPropagation();
    current.samples = [...current.samples.slice(-7), { time: event.timeStamp, travel: dx }];
    dragTo(dx);
  }
  function swipeEnd(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const current = swipe.current;
    if (!current || current.pointer !== event.pointerId) return;
    swipe.current = null;
    if (!current.horizontal) return;
    current.samples.push({ time: event.timeStamp, travel: event.clientX - current.x });
    release(dragVelocity(current.samples, event.timeStamp), cancelled);
  }
  function pageKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!paging || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    const step = keyboardPageStep(event);
    if (step && turn(step)) event.preventDefault();
  }
  useLayoutEffect(() => {
    const d = drag.current;
    // A drag's silent turn: the neighbour is drawn beside the copy, or the first page again under it.
    if (d && d.drawn !== d.side) {
      d.drawn = d.side;
      d.back = d.side > 0 ? pagerRef.current?.previous : d.side < 0 ? pagerRef.current?.next : undefined;
      const top = d.side ? 0 : d.scrollTop;
      scroller.current?.scrollTo({ top });
      d.copy?.style.setProperty("top", `${d.top - d.scrollTop + top}px`);
      if (d.settle || d.closing) content.current?.style.setProperty("visibility", "hidden");
      place(d);
      firstPage.current = page;
      firstBase.current = base;
      firstDepth.current = depth;
      if (d.closing) d.closing();
      else if (d.released) gesture.current.release(d.released.velocity, d.released.cancelled);
      return;
    }
    scroller.current?.scrollTo({ top: 0 });
    if (page !== firstPage.current && paged.current) {
      keepFocus();
      setAnnounced(true);
    } else if (page !== firstPage.current) corner.current?.focus({ preventScroll: true });
    paged.current = false;
    // Slides only when the page changes with the surface open; on opening, the surface animates.
    // An inner page keeps the content mounted, with its drafts, so the slide replays on the same element.
    const slide = page !== firstPage.current && open && wasOpen.current;
    if (slide && settled.current) {
      const back = goingBack.current || (base === firstBase.current && depth < firstDepth.current);
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      content.current?.animate(
        reduced
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, translate: back ? "-1.5rem 0" : "1.5rem 0" },
              { opacity: 1, translate: "0 0" },
            ],
        { duration: 300, easing: "ease-out" },
      );
    }
    goingBack.current = false;
    firstPage.current = page;
    firstBase.current = base;
    firstDepth.current = depth;
    if (open === wasOpen.current && !slide && frame.current) return;
    wasOpen.current = open;
    settled.current = false;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      settled.current = true;
    });
  }, [page, base, depth, open]);
  return (
    <SheetSurface
      ref={setSurface}
      data-action-scope={scope}
      height={height}
      initialFocus={initialFocus ?? corner}
      onCloseAutoFocus={onCloseAutoFocus}
      onKeyDown={pageKey}
      className={paging ? "overscroll-x-none" : undefined}
      {...(description || subtitle ? {} : { "aria-describedby": undefined })}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
        {compact && kind !== "menu" && <div className="mx-auto mt-1.5 h-1.5 w-9 rounded-full bg-muted-foreground/30" />}
        <div className={cn("flex h-12 items-center px-2", !compact || kind === "menu" ? "mt-2" : "mt-0")}>
          <span className={pager ? "w-24" : "w-12"}>
            {/* A single button: switching from Back to Close must not drop focus. */}
            <GlassButton
              ref={corner}
              shape="circle"
              aria-label={onBack ? "Back" : closeLabel}
              onClick={
                onBack
                  ? () => {
                      goingBack.current = true;
                      onBack();
                    }
                  : onClose
              }
            >
              {onBack ? <ChevronLeft aria-hidden="true" /> : <X aria-hidden="true" />}
            </GlassButton>
          </span>
          {shown.subtitle ? (
            <span className="min-w-0 flex-1 text-center">
              <SheetTitle variant="bar">{shown.title}</SheetTitle>
              <SheetDescription variant="bar">{shown.subtitle}</SheetDescription>
            </span>
          ) : (
            <SheetTitle variant="bar">{shown.title}</SheetTitle>
          )}
          {pager ? (
            <span className="flex w-24 justify-end">
              <ToolbarGroup data-pager aria-label="Pages">
                <GlassButton
                  shape="circle"
                  aria-label={pager.previousLabel}
                  disabled={!pager.previous}
                  onClick={() => turn(-1)}
                >
                  <ChevronLeft aria-hidden="true" />
                </GlassButton>
                <GlassButton shape="circle" aria-label={pager.nextLabel} disabled={!pager.next} onClick={() => turn(1)}>
                  <ChevronRight aria-hidden="true" />
                </GlassButton>
              </ToolbarGroup>
            </span>
          ) : (
            <span className="w-12" />
          )}
        </div>
        {pager && (
          <span className="sr-only" aria-live="polite">
            {announced ? shown.title : null}
          </span>
        )}
        {description && !subtitle ? <SheetDescription hidden>{description}</SheetDescription> : null}
        {top && <div className="pointer-events-auto px-4 pt-1">{top}</div>}
      </div>
      <div
        ref={scroller}
        data-edge-footer={bottom ? "true" : undefined}
        data-edge-search={top ? "true" : undefined}
        onPointerDown={swipeStart}
        onPointerMove={swipeMove}
        onPointerUp={(event) => swipeEnd(event)}
        onPointerCancel={(event) => swipeEnd(event, true)}
        className={cn(
          "edge-mask sheet-edge-mask min-h-0 flex-1 overflow-y-auto overflow-x-hidden",
          paging && "relative touch-pan-y",
          top ? "pt-32" : "pt-16",
          !bleed && "px-4",
          bottom ? "sheet-end-footer" : kind === "menu" && compact ? "pb-4" : "sheet-end",
        )}
      >
        <div key={base} ref={content} className="section-stack sheet-sections">
          {children}
          <ActionErrorText scope={scope} placement="sheet" />
        </div>
      </div>
      {bottom && <div className="sheet-footer absolute inset-x-0 bottom-0 z-10 px-4">{bottom}</div>}
    </SheetSurface>
  );
}

/** Stack of pages inside one sheet: push opens a page, back returns, reset goes to the root. */
export function usePageStack<Page>(root: Page, initialPage: Page = root) {
  const [stack, setStack] = useState<Page[]>(initialPage === root ? [root] : [root, initialPage]);
  return {
    page: stack[stack.length - 1],
    depth: stack.length,
    push: (next: Page) => setStack((current) => [...current, next]),
    back: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    reset: (next: Page = root) => setStack([next]),
  };
}
