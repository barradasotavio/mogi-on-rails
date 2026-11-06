import type { ComponentProps } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";
import { TableHead } from "@/vendor/shadcn/ui/table";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/vendor/shadcn/ui/table";

/** Row labels can contain long Lounge/team names without forcing horizontal overflow. */
export function TableRowHeader({ className, ...props }: ComponentProps<typeof TableHead>) {
  return <TableHead scope="row" className={cn("whitespace-normal break-words", className)} {...props} />;
}
