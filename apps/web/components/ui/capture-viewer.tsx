"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { Dialog, DialogClose, DialogDescription, DialogTitle, FullscreenDialogContent } from "@/components/ui/dialog";
import { GlassButton } from "@/components/ui/glass-button";
import { keyboardPageStep, listenForTrackpadPaging } from "@/components/ui/paging";

export interface ViewerImage {
  original: Blob | null;
  alt: string;
  /** Short moment, as in Images: "Race 2 · after the race". */
  label?: string;
}

const MIN = 1,
  MAX = 4,
  STEP = 2.5;
const ViewerContext = createContext<((index: number, trigger: HTMLElement) => void) | null>(null);

/**
 * The single fullscreen viewer for every screenshot and crop. The surface is opaque content; close and
 * navigation are glass controls inside the safe areas. Zoom and pan are pointer events on a CSS transform,
 * with no zoom library. Focus goes to Close on open and back to the trigger on close.
 */
export function CaptureViewer({ images, children }: { images: ViewerImage[]; children: ReactNode }) {
  const [state, setState] = useState({ open: false, index: 0 });
  const trigger = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const index = Math.min(state.index, images.length - 1);
  const image = images[index];
  const many = images.length > 1;
  const go = (step: number) =>
    setState((value) => ({ ...value, index: Math.max(0, Math.min(images.length - 1, value.index + step)) }));
  // Escape closes only the viewer: the sheet behind it (inspector) also took itself for the top layer and closed too.
  const shown = state.open && !!image;
  useEffect(() => {
    if (!shown) return;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setState((value) => ({ ...value, open: false }));
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [shown]);
  // Gestures must not reach the sheets behind: the synthetic event crosses the portal up to Vaul.
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  // A two-finger trackpad swipe at 1× changes capture, and never reaches the browser's back/forward swipe. The
  // listener lives on the surface, not the image, so one swipe's momentum can't turn a second page on the next image.
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const page = useRef(go);
  useEffect(() => {
    page.current = many ? go : () => {};
  });
  useEffect(() => {
    if (!surface) return;
    return listenForTrackpadPaging(surface, {
      onStep: (step) => {
        page.current(step);
      },
      canPage: () => !surface.querySelector("[data-zoomed]"),
    });
  }, [surface]);
  return (
    <ViewerContext
      value={(start, element) => {
        trigger.current = element;
        setState({ open: true, index: start });
      }}
    >
      {children}
      <Dialog open={shown} onOpenChange={(open) => setState((value) => ({ ...value, open }))}>
        <FullscreenDialogContent
          ref={setSurface}
          className="overscroll-x-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            close.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
          }}
          onPointerDown={stop}
          onPointerMove={stop}
          onPointerUp={stop}
          onTouchStart={stop}
          onTouchMove={stop}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            // The sheet behind pages with the same keys: they belong to the viewer while it is open.
            event.stopPropagation();
            const step = keyboardPageStep(event);
            if (many && step) {
              event.preventDefault();
              go(step);
            }
          }}
        >
          <DialogTitle className="sr-only">Screenshot viewer</DialogTitle>
          <DialogDescription className="sr-only">
            Pinch, double-tap or click to zoom, and drag to move.
            {many ? " Swipe or use the arrows to change screenshot." : ""}
          </DialogDescription>
          {image?.original === null && (
            <div className="flex min-h-full items-center justify-center bg-muted text-sm text-muted-foreground">
              Screenshot deleted to free space.
            </div>
          )}
          {image?.original && (
            <ViewerStage
              key={index}
              image={image}
              onDismiss={() => setState((value) => ({ ...value, open: false }))}
              onPage={many ? go : undefined}
            />
          )}
          <div className="viewer-top viewer-inline pointer-events-none absolute inset-x-0 z-10 flex items-center gap-2">
            <DialogClose asChild>
              <GlassButton ref={close} shape="circle" aria-label="Close">
                <X aria-hidden="true" />
              </GlassButton>
            </DialogClose>
            <span className="flex min-w-0 flex-1 justify-center">
              {image?.label && (
                <p className="glass min-w-0 truncate rounded-full px-4 py-2 text-sm font-semibold">{image.label}</p>
              )}
            </span>
            <span className="w-11 shrink-0" />
          </div>
          {many && (
            <div className="viewer-bottom viewer-inline pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center gap-3">
              <GlassButton
                shape="circle"
                aria-label="Previous Screenshot"
                disabled={index === 0}
                onClick={() => go(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </GlassButton>
              <p className="glass rounded-full px-4 py-2 text-sm font-medium tabular-nums" aria-live="polite">
                {index + 1} of {images.length}
              </p>
              <GlassButton
                shape="circle"
                aria-label="Next Screenshot"
                disabled={index === images.length - 1}
                onClick={() => go(1)}
              >
                <ChevronRight aria-hidden="true" />
              </GlassButton>
            </div>
          )}
        </FullscreenDialogContent>
      </Dialog>
    </ViewerContext>
  );
}

/**
 * A screenshot or crop that opens the viewer. The control covers its content instead of wrapping it,
 * so the image keeps its own role and name.
 */
export function CaptureViewerTrigger({
  index = 0,
  label = "Enlarge screenshot",
  children,
}: {
  index?: number;
  label?: string;
  children: ReactNode;
}) {
  const open = useContext(ViewerContext);
  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={(event) => open?.(index, event.currentTarget)}
        className="absolute inset-0 cursor-zoom-in rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </div>
  );
}

interface View {
  scale: number;
  x: number;
  y: number;
}
interface Gesture {
  kind: "pan" | "swipe" | "pinch" | "dismiss" | "page";
  pointer: string;
  startX: number;
  startY: number;
  time: number;
  moved: boolean;
  origin: View;
  distance: number;
  midX: number;
  midY: number;
}

function ViewerStage({
  image,
  onDismiss,
  onPage,
}: {
  image: ViewerImage;
  onDismiss: () => void;
  onPage?: (step: number) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLImageElement>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!image.original) return;
    const url = URL.createObjectURL(image.original);
    if (media.current) media.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [image.original]);

  function bounds(scale: number) {
    const area = stage.current!,
      picture = media.current!;
    return {
      x: Math.max(0, (picture.offsetWidth * scale - area.clientWidth) / 2),
      y: Math.max(0, (picture.offsetHeight * scale - area.clientHeight) / 2),
    };
  }
  function apply(next: View, { animate = false, clamp = true, fade = 1 } = {}) {
    const limit = bounds(next.scale);
    view.current = clamp
      ? {
          scale: next.scale,
          x: Math.max(-limit.x, Math.min(limit.x, next.x)),
          y: Math.max(-limit.y, Math.min(limit.y, next.y)),
        }
      : next;
    const picture = media.current,
      area = stage.current;
    if (!picture || !area) return;
    picture.toggleAttribute("data-animate", animate);
    picture.style.setProperty("--viewer-x", `${view.current.x}px`);
    picture.style.setProperty("--viewer-y", `${view.current.y}px`);
    picture.style.setProperty("--viewer-scale", String(view.current.scale));
    area.parentElement?.style.setProperty("--viewer-fade", String(fade));
    area.toggleAttribute("data-zoomed", view.current.scale > 1);
  }
  /** Zooms keeping the point under the finger or cursor fixed. */
  function zoomAt(scale: number, clientX: number, clientY: number, animate = false) {
    const from = view.current;
    const area = stage.current!.getBoundingClientRect();
    const next = Math.max(MIN, Math.min(MAX, scale));
    const cx = clientX - area.left - area.width / 2,
      cy = clientY - area.top - area.height / 2;
    apply(
      { scale: next, x: cx - ((cx - from.x) * next) / from.scale, y: cy - ((cy - from.y) * next) / from.scale },
      { animate },
    );
  }
  function toggle(clientX: number, clientY: number) {
    if (view.current.scale > 1) apply({ scale: 1, x: 0, y: 0 }, { animate: true });
    else zoomAt(STEP, clientX, clientY, true);
  }
  function begin(kind: Gesture["kind"], event: { clientX: number; clientY: number; pointerType: string }) {
    const [a, b] = [...pointers.current.values()];
    gesture.current = {
      kind,
      pointer: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      time: performance.now(),
      moved: gesture.current?.moved ?? false,
      origin: { ...view.current },
      distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      midX: b ? (a.x + b.x) / 2 : 0,
      midY: b ? (a.y + b.y) / 2 : 0,
    };
  }

  // Wheel and Safari's gestures need non-passive listeners to prevent page zoom.
  useEffect(() => {
    const area = stage.current;
    if (!area) return;
    let gestureStart = 1;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        zoomAt(view.current.scale * Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
      } else if (view.current.scale > 1) {
        event.preventDefault();
        apply({ ...view.current, x: view.current.x - event.deltaX, y: view.current.y - event.deltaY });
      }
    };
    const start = (event: Event) => {
      event.preventDefault();
      gestureStart = view.current.scale;
    };
    const change = (event: Event) => {
      event.preventDefault();
      const safari = event as Event & { scale: number; clientX: number; clientY: number };
      if (pointers.current.size < 2) zoomAt(gestureStart * safari.scale, safari.clientX, safari.clientY);
    };
    area.addEventListener("wheel", wheel, { passive: false });
    area.addEventListener("gesturestart", start);
    area.addEventListener("gesturechange", change);
    return () => {
      area.removeEventListener("wheel", wheel);
      area.removeEventListener("gesturestart", start);
      area.removeEventListener("gesturechange", change);
    };
  });

  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      if (gesture.current) gesture.current.moved = true;
      begin("pinch", event);
    } else if (pointers.current.size === 1) {
      gesture.current = null;
      begin(view.current.scale > 1 ? "pan" : "swipe", event);
    }
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY;
    if (current.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const area = stage.current!.getBoundingClientRect();
      const scale = Math.max(
        MIN,
        Math.min(MAX, (current.origin.scale * Math.hypot(a.x - b.x, a.y - b.y)) / current.distance),
      );
      const mx = (a.x + b.x) / 2 - area.left - area.width / 2,
        my = (a.y + b.y) / 2 - area.top - area.height / 2;
      const ox = current.midX - area.left - area.width / 2,
        oy = current.midY - area.top - area.height / 2;
      apply({
        scale,
        x: mx - ((ox - current.origin.x) * scale) / current.origin.scale,
        y: my - ((oy - current.origin.y) * scale) / current.origin.scale,
      });
      return;
    }
    if (!current.moved && Math.hypot(dx, dy) < 8) return;
    current.moved = true;
    if (current.kind === "pan") apply({ ...view.current, x: current.origin.x + dx, y: current.origin.y + dy });
    else if (current.kind === "swipe" && current.pointer !== "mouse")
      current.kind = Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "dismiss" : "swipe") : onPage ? "page" : "swipe";
    if (current.kind === "dismiss")
      apply({ scale: 1, x: 0, y: Math.max(0, dy) }, { clamp: false, fade: 1 - Math.min(0.6, Math.max(0, dy) / 400) });
    else if (current.kind === "page") apply({ scale: 1, x: dx, y: 0 }, { clamp: false });
  }
  function up(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = gesture.current;
    if (!current) return;
    if (pointers.current.size === 1) {
      // One finger continues the gesture as a drag of the zoomed image.
      const [rest] = [...pointers.current.values()];
      begin(view.current.scale > 1 ? "pan" : "swipe", {
        clientX: rest.x,
        clientY: rest.y,
        pointerType: current.pointer,
      });
      return;
    }
    if (pointers.current.size) return;
    gesture.current = null;
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY,
      elapsed = performance.now() - current.time;
    if (current.kind === "dismiss") {
      if (!cancelled && (dy > 120 || (dy > 40 && dy / elapsed > 0.5))) onDismiss();
      else apply({ scale: 1, x: 0, y: 0 }, { animate: true });
      return;
    }
    if (current.kind === "page") {
      apply({ scale: 1, x: 0, y: 0 }, { animate: true });
      if (!cancelled && Math.abs(dx) > 60) onPage?.(dx < 0 ? 1 : -1);
      return;
    }
    if (current.kind === "pinch") {
      if (view.current.scale < 1.05) apply({ scale: 1, x: 0, y: 0 }, { animate: true });
      return;
    }
    if (cancelled || current.moved || elapsed > 350) return;
    if (current.pointer === "mouse") {
      toggle(event.clientX, event.clientY);
      return;
    }
    const now = performance.now(),
      last = lastTap.current;
    if (last && now - last.time < 300 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 40) {
      lastTap.current = null;
      toggle(event.clientX, event.clientY);
    } else lastTap.current = { time: now, x: event.clientX, y: event.clientY };
  }

  return (
    <div
      ref={stage}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(event) => up(event)}
      onPointerCancel={(event) => up(event, true)}
      className="absolute inset-0 flex touch-none select-none items-center justify-center overflow-hidden cursor-zoom-in data-zoomed:cursor-grab data-zoomed:active:cursor-grabbing motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <img ref={media} alt={image.alt} draggable={false} className="viewer-media max-h-full max-w-full" />
    </div>
  );
}
