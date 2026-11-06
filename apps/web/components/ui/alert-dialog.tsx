import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { AlertDialogPortal } from "@/vendor/shadcn/ui/alert-dialog";
export * from "@/vendor/shadcn/ui/alert-dialog";

/**
 * The alert surface, composed from the primitive so its overlay follows the material. Opaque, it sits on
 * `scrim`; in glass (`BlockingAlert`) the overlay is clear and the glass dims around itself (`glass-scrim`),
 * so it samples the content instead of a scrim.
 */
export function AlertDialogContent({
  material = "opaque",
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content> & {
  material?: "opaque" | "glass";
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className={cn(
          "fixed inset-0 z-50",
          material === "opaque" &&
            "scrim duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        )}
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size="default"
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full max-w-xs -translate-x-1/2 -translate-y-1/2 gap-6 rounded-xl p-6 text-popover-foreground duration-100 outline-none sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          material === "glass" ? "glass glass-scrim" : "bg-popover shadow-2xl ring-1 ring-foreground/10 dark:bg-muted",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}
