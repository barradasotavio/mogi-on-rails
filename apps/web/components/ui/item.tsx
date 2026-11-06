import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { ItemDescription as OriginalItemDescription, ItemTitle as OriginalItemTitle } from "@/vendor/shadcn/ui/item";
export * from "@/vendor/shadcn/ui/item";

/** Participant names and participation metadata must remain readable in full. */
export function ItemTitle({
  wrap = false,
  className,
  ...props
}: ComponentProps<typeof OriginalItemTitle> & { wrap?: boolean }) {
  return <OriginalItemTitle className={cn(wrap && "line-clamp-none break-words", className)} {...props} />;
}

export function ItemDescription({
  wrap = false,
  className,
  ...props
}: ComponentProps<typeof OriginalItemDescription> & { wrap?: boolean }) {
  return <OriginalItemDescription className={cn(wrap && "line-clamp-none break-words", className)} {...props} />;
}
