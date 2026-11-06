import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent as OriginalDialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/vendor/shadcn/ui/dialog";
export { Dialog, DialogClose, DialogDescription, DialogTitle, DialogTrigger };
/**
 * The opaque fullscreen surface of `CaptureViewer`, its only composition: images are content, so the
 * surface is opaque; the viewer owns its glass controls. Consultations and forms use Sheet.
 */
export function FullscreenDialogContent({ className, ...props }: ComponentProps<typeof OriginalDialogContent>) {
  return (
    <OriginalDialogContent
      showCloseButton={false}
      className={cn(
        "inset-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 overflow-clip rounded-none bg-background p-0 ring-0 viewer-fade sm:max-w-none",
        className,
      )}
      {...props}
    />
  );
}
