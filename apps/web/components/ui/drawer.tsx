"use client";
import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { DrawerContent as OriginalDrawerContent } from "@/vendor/shadcn/ui/drawer";
export {
  Drawer,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/vendor/shadcn/ui/drawer";

export function DrawerContent({ className, ...props }: ComponentProps<typeof OriginalDrawerContent>) {
  return <OriginalDrawerContent className={cn("app-sheet", className)} {...props} />;
}
