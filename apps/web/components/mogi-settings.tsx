"use client";

import { mogiOriginalList, type SequenceAnswer } from "@mkw/engine";
import { type ComponentProps, useRef, useState } from "react";

import { captureEntries, type CapturePage, capturePages } from "@/components/captures/capture-pages";
import { useResultsExport } from "@/components/results-export";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { Sheet, usePageStack } from "@/components/ui/sheet";
import type { Mogi, SharedFile } from "@/lib/mogi/types";

type Page = "settings" | "original" | "export" | CapturePage;

export function MogiSettings({
  mogi,
  resultMogi,
  pendingFiles,
  busy,
  open,
  onOpenChange,
  onCloseAutoFocus,
  initialCaptureId,
  onUpdate,
  onRemoveSource,
  onRemovePendingSource,
  onSequenceAnswer,
  onQuestion,
  onDelete,
}: {
  mogi: Mogi;
  resultMogi?: Mogi;
  pendingFiles: SharedFile[];
  busy: boolean;
  open: boolean;
  initialCaptureId?: string;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: ComponentProps<typeof Sheet>["onCloseAutoFocus"];
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onRemoveSource: (id: string) => Promise<boolean>;
  onRemovePendingSource?: (id: string) => Promise<boolean>;
  onSequenceAnswer: (answer: SequenceAnswer, signature: string) => Promise<boolean>;
  onQuestion: (id: string) => void;
  onDelete: () => Promise<boolean>;
}) {
  const initialPage: Page = initialCaptureId ? { kind: "image", id: initialCaptureId } : "settings";
  const pages = usePageStack<Page>(initialPage);
  const [wasOpen, setWasOpen] = useState(open);
  const [confirm, setConfirm] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) pages.reset("settings");
  }
  const page = pages.page;
  const exported = useResultsExport({ mogi, resultMogi, onUpdate, saving: busy, open: open && page === "export" });
  const captures =
    typeof page === "object"
      ? capturePages({
          mogi,
          pendingFiles,
          page,
          busy,
          push: pages.push,
          back: pages.back,
          onUpdate,
          onRemoveSource,
          onRemovePendingSource,
          onSequenceAnswer,
          onQuestion,
        })
      : undefined;
  const title = captures
    ? captures.title
    : page === "original"
      ? "Bot List"
      : page === "export"
        ? "Export"
        : "Mogi Settings";
  return (
    <>
      <Sheet
        kind="detail"
        height="full"
        open={open}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
        title={title}
        page={typeof page === "string" ? page : captures?.key}
        onBack={pages.depth > 1 ? pages.back : undefined}
        footer={page === "export" ? exported.footer : undefined}
      >
        {page === "settings" ? (
          <>
            <ListGroup>
              <List dividers="row" aria-label="Mogi">
                <ListRow onSelect={() => pages.push("original")} accessory="chevron">
                  Bot List
                </ListRow>
                <ListRow
                  onSelect={() => pages.push({ kind: "list" })}
                  accessory="chevron"
                  trail={captureEntries(mogi, pendingFiles).length}
                >
                  Screenshots
                </ListRow>
                <ListRow disabled={busy} onSelect={() => pages.push("export")} accessory="chevron">
                  Export
                </ListRow>
              </List>
            </ListGroup>
            <ListGroup>
              <List aria-label="Delete">
                <ListRow
                  action="destructive"
                  buttonProps={{ ref: deleteTrigger }}
                  disabled={busy}
                  onSelect={() => setConfirm(true)}
                >
                  Delete Mogi
                </ListRow>
              </List>
            </ListGroup>
          </>
        ) : page === "export" ? (
          exported.body
        ) : page === "original" ? (
          <ListGroup>
            <pre className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-muted p-3 text-sm leading-relaxed select-text">
              {mogiOriginalList(mogi)}
            </pre>
          </ListGroup>
        ) : (
          captures?.content
        )}
      </Sheet>
      <ConfirmationDialog
        open={confirm}
        onOpenChange={setConfirm}
        busy={busy}
        title={`Delete ${mogi.name}?`}
        description="This can't be undone."
        confirmLabel="Delete Mogi"
        errorMessage="Couldn't delete the mogi. Your data was kept. Try again."
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus();
        }}
        onConfirm={async () => {
          const success = await onDelete();
          if (success) onOpenChange(false);
          return success;
        }}
      />
    </>
  );
}
