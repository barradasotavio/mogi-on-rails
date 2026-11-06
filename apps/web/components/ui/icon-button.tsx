import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/vendor/shadcn/lib/utils";

export function IconButton({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="icon-lg" className={cn("size-11", className)} {...props} />;
}
