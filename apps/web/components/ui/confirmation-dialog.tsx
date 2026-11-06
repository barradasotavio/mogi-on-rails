"use client";

import { type ComponentProps, type ReactNode, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useUpdateBlock } from "@/components/ui/update-activity";
import { settled } from "@/lib/settled";

export function ConfirmationDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  errorMessage = "Couldn't finish. Your work was kept. Try again.",
  onConfirm,
  busy = false,
  open: controlledOpen,
  onOpenChange,
  onCloseAutoFocus,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: ComponentProps<typeof AlertDialogContent>["onCloseAutoFocus"];
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  errorMessage?: string;
  onConfirm: () => Promise<unknown>;
  busy?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  useUpdateBlock(open);
  function setOpen(next: boolean) {
    setLocalOpen(next);
    onOpenChange?.(next);
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const disabled = busy || pending;
  async function confirm() {
    if (disabled) return;
    setPending(true);
    setError(false);
    return settled(
      async () => {
        try {
          const result = await onConfirm();
          if (result === false) setError(true);
          else setOpen(false);
        } catch {
          setError(true);
        }
      },
      () => {
        setPending(false);
      },
    );
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!disabled) {
          setOpen(next);
          setError(false);
        }
      }}
    >
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent aria-busy={disabled} onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disabled}>{cancelLabel}</AlertDialogCancel>
          <Button variant="destructive" disabled={disabled} onClick={() => void confirm()}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
