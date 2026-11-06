"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { type ComponentProps, type ReactNode, useEffect } from "react";

import { useSidebarAnchored, useSizeClass } from "@/components/ui/size-class";

/**
 * Navigation sidebar on the left; Radix keeps focus and mounting during the exit. Focus starts on the list's first
 * action and returns to Show Mogis (`onCloseAutoFocus`); opening a sheet hands focus to it. Enters from the
 * left in 300 ms and leaves in 200 ms, fading and sliding; with reduced motion, only fading.
 * It and the scrim sit below the toolbar, whose button stays in place, becomes Hide Mogis and closes it.
 */
/**
 * The docked sidebar, from 1280px: it reaches the window edge with a hairline and slides its width away when
 * closed, so the content widens with it (`sidebar-docked`). Closed, it is inert and leaves the tab order.
 * It has the content's background, not the overlay's surface: under Window Controls Overlay the browser
 * paints the window controls above it in one color, theme-color, which is the content's background.
 */
export function DockedSidebar({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Mogis"
      data-state={open ? "open" : "closed"}
      inert={!open}
      className="sidebar-docked hidden h-full shrink-0 overflow-hidden border-r border-rule bg-background text-foreground xl:block"
    >
      <div className="h-full w-80 overflow-y-auto">{children}</div>
    </aside>
  );
}

export function SidebarOverlay({
  open,
  onOpenChange,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  onCloseAutoFocus: ComponentProps<typeof DialogPrimitive.Content>["onCloseAutoFocus"];
}) {
  const sizeClass = useSizeClass();
  const anchored = useSidebarAnchored();
  useEffect(() => {
    // On a layout change, releases the trapped focus; the mogi and its sheets stay mounted.
    if (open && (sizeClass !== "regular" || anchored)) onOpenChange(false);
  }, [open, onOpenChange, sizeClass, anchored]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="sidebar-veil"
          className="scrim below-toolbar fixed inset-x-0 bottom-0 z-40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200"
        />
        {/* The toolbar's toggle closes it by its own click; dismissing on its pointerdown would reopen it. */}
        <DialogPrimitive.Content
          data-slot="sidebar-panel"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={(event) => {
            if ((event.target as Element | null)?.closest?.("[data-show-mogis]")) event.preventDefault();
          }}
          className="sidebar-panel-inset fixed left-2 z-50 w-80 overflow-y-auto rounded-[1.5rem] bg-popover text-popover-foreground shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-safe:data-[state=open]:slide-in-from-left-8 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:slide-out-to-left-8 data-[state=closed]:duration-200"
        >
          <DialogPrimitive.Title className="sr-only">Mogis</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
