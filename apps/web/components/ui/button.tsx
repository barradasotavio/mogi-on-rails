import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { Button as OriginalButton } from "@/vendor/shadcn/ui/button";

type ButtonProps = Omit<ComponentProps<typeof OriginalButton>, "variant"> & {
  variant?: ComponentProps<typeof OriginalButton>["variant"] | "destructive-ghost" | "ghost-primary";
};

export function Button({ variant, className, ...props }: ButtonProps) {
  const destructiveGhost = variant === "destructive-ghost",
    primaryGhost = variant === "ghost-primary";
  return (
    <OriginalButton
      size="lg"
      variant={destructiveGhost || primaryGhost ? "ghost" : variant}
      className={cn(
        destructiveGhost && "text-destructive hover:text-destructive",
        primaryGhost && "text-link hover:text-link",
        className,
      )}
      {...props}
    />
  );
}
