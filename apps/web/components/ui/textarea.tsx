import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { Textarea as OriginalTextarea } from "@/vendor/shadcn/ui/textarea";

/** `filled` is the field inside sheets: subtle, no border, as an iOS text area. Read-only text can't be resized. */
export function Textarea({
  variant = "default",
  className,
  ...props
}: ComponentProps<typeof OriginalTextarea> & { variant?: "default" | "filled" }) {
  return (
    <OriginalTextarea
      className={cn(
        variant === "filled" && "rounded-xl border-transparent bg-muted p-3 shadow-none dark:bg-muted",
        props.readOnly && "resize-none",
        className,
      )}
      {...props}
    />
  );
}
