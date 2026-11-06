import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { NativeSelect as OriginalNativeSelect } from "@/vendor/shadcn/ui/native-select";
export { NativeSelectOptGroup, NativeSelectOption } from "@/vendor/shadcn/ui/native-select";

export function NativeSelect({ className, ...props }: ComponentProps<typeof OriginalNativeSelect>) {
  return (
    <OriginalNativeSelect
      className={cn("w-full [&_select]:min-h-11 [&_select]:text-base md:[&_select]:text-sm", className)}
      {...props}
    />
  );
}
