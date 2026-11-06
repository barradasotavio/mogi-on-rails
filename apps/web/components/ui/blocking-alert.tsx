"use client";

import { TriangleAlert } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GlassButton } from "@/components/ui/glass-button";
import { useUpdateBlock } from "@/components/ui/update-activity";

export interface BlockingAlertAction {
  label: string;
  onSelect: () => void;
}
export interface BlockingAlertContent {
  title: string;
  description: ReactNode;
  /** The caution triangle, only where data can be lost. */
  caution?: boolean;
  /** The default action: tint, focused, trailing on regular and on top when stacked. */
  primary: BlockingAlertAction;
  /** The neutral alternative. */
  secondary?: BlockingAlertAction;
}

/**
 * A blocking failure: a centered alert in regular glass that says what happened and offers only its ways out.
 * Escape and a click outside never dismiss it, because the cause is still there. It is open while `alert`
 * is set and keeps its last content while it animates out. While `busy`, the buttons keep focus and ignore presses.
 * Its glass dims the screen around itself instead of sitting on a scrim, so it samples the content, not the dim.
 */
export function BlockingAlert({ alert, busy = false }: { alert: BlockingAlertContent | null; busy?: boolean }) {
  const primaryButton = useRef<HTMLButtonElement>(null);
  const [last, setLast] = useState(alert);
  if (alert && (alert.title !== last?.title || alert.description !== last?.description)) setLast(alert);
  const shown = alert ?? last;
  useUpdateBlock(!!alert);
  const press = (action: BlockingAlertAction) => () => {
    if (alert && !busy) action.onSelect();
  };
  return (
    <AlertDialog open={!!alert}>
      {shown && (
        <AlertDialogContent
          material="glass"
          aria-busy={busy}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            primaryButton.current?.focus();
          }}
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <AlertDialogHeader>
            {shown.caution && <TriangleAlert aria-hidden="true" className="size-8 text-destructive" />}
            <AlertDialogTitle>{shown.title}</AlertDialogTitle>
            <AlertDialogDescription>{shown.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {/* Column-reverse puts the default on top when stacked; the row keeps it trailing. */}
          <AlertDialogFooter>
            {shown.secondary && (
              <GlassButton className="w-full sm:w-auto" onClick={press(shown.secondary)}>
                {shown.secondary.label}
              </GlassButton>
            )}
            <GlassButton ref={primaryButton} tint className="w-full sm:w-auto" onClick={press(shown.primary)}>
              {shown.primary.label}
            </GlassButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
