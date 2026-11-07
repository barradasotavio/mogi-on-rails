"use client";

import { mogiOriginalList, screens, type SequenceAnswer, sequenceInputSignature } from "@mkw/engine";
import { type ComponentProps, useRef, useState } from "react";

import { CaptureImage, CaptureThumbnail } from "@/components/captures/capture-image";
import { CountingExplanation } from "@/components/captures/counting-explanation";
import { NameCorrection } from "@/components/name-correction";
import { useResultsExport } from "@/components/results-export";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { Sheet, usePageStack } from "@/components/ui/sheet";
import { imageLabel, imageMoment, imageRace } from "@/lib/mogi/capture-label";
import type { Mogi, SharedFile } from "@/lib/mogi/types";

type Page =
  | "settings"
  | "images"
  | "original"
  | "export"
  | { kind: "image" | "race" | "numbers"; id: string }
  | { kind: "name"; id: string; row: number };

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
  const entries = [
    ...(mogi.captures ?? []).map((capture) => ({
      id: capture.id,
      capture,
      itemId: undefined as string | undefined,
      fileName: capture.fileName,
      original: capture.original,
      number: imageRace(mogi, capture),
      failed: false,
    })),
    ...(mogi.captureReview?.items ?? []).flatMap((item) => {
      const file = pendingFiles.find((file) => file.id === item.source.fileId);
      return file && item.status !== "saved"
        ? [
            {
              id: item.id,
              capture: undefined,
              itemId: item.id,
              fileName: file.name,
              original: file.original,
              number: item.numberKnown === false ? undefined : item.number,
              failed: item.status === "failed",
            },
          ]
        : [];
    }),
  ];
  const page = pages.page;
  const exported = useResultsExport({ mogi, resultMogi, onUpdate, saving: busy, open: open && page === "export" });
  const image = typeof page === "object" ? entries.find((entry) => entry.id === page.id) : undefined;
  const capture = image?.capture;
  const title =
    typeof page === "string"
      ? page === "images"
        ? "Screenshots"
        : page === "original"
          ? "Bot List"
          : page === "export"
            ? "Export"
            : "Mogi Settings"
      : page.kind === "name"
        ? (mogi.participants.find((p) => p.id === capture?.nameAssociations?.[page.row - 1]?.participantId)
            ?.loungeName ?? "Name")
        : page.kind === "numbers"
          ? "Numbers Read"
          : page.kind === "race"
            ? "Race"
            : `Screenshot ${entries.findIndex((entry) => entry.id === page.id) + 1}`;
  async function assign(number: number | null) {
    if (
      capture &&
      (await onSequenceAnswer({ kind: "number", captureId: capture.id, value: number }, sequenceInputSignature(mogi)))
    )
      pages.back();
  }
  return (
    <>
      <Sheet
        kind="detail"
        height="full"
        open={open}
        onOpenChange={onOpenChange}
        onCloseAutoFocus={onCloseAutoFocus}
        title={title}
        page={typeof page === "string" ? page : `${page.kind}-${page.id}`}
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
                <ListRow onSelect={() => pages.push("images")} accessory="chevron" trail={entries.length}>
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
        ) : page === "images" ? (
          <List aria-label="Mogi screenshots">
            {entries.map((entry) => (
              <ListRow
                key={entry.id}
                media={<CaptureThumbnail original={entry.original} />}
                description={entry.fileName}
                accessory="chevron"
                onSelect={() => pages.push({ kind: "image", id: entry.id })}
              >
                {imageLabel(entry.number, entry.capture)}
              </ListRow>
            ))}
          </List>
        ) : image && typeof page === "object" ? (
          page.kind === "image" ? (
            <>
              <CaptureImage original={image.original} alt={image.fileName} label={imageLabel(image.number, capture)} />
              {image.failed && <p className="text-sm text-muted-foreground">Reading failed</p>}
              <List dividers="row">
                <ListRow
                  disabled={!capture || busy}
                  accessory="chevron"
                  trail={image.number ?? "Not Assigned"}
                  onSelect={() => pages.push({ kind: "race", id: image.id })}
                >
                  Race
                </ListRow>
                <ListRow trail={imageMoment(capture).replace(/^./, (letter) => letter.toUpperCase())}>Moment</ListRow>
                <ListRow trail={capture?.interpretation ? screens[capture.interpretation.screen].name : "Not read"}>
                  Screen
                </ListRow>
              </List>
              {capture && (
                <CountingExplanation
                  mogi={mogi}
                  captureId={capture.id}
                  busy={busy}
                  onRace={() => pages.push({ kind: "race", id: image.id })}
                  onName={(row) => pages.push({ kind: "name", id: image.id, row })}
                  onQuestion={onQuestion}
                />
              )}
              <List dividers="row">
                <ListRow accessory="chevron" onSelect={() => pages.push({ kind: "numbers", id: image.id })}>
                  Numbers Read
                </ListRow>
              </List>
              <Button
                variant="destructive-ghost"
                className="w-full"
                disabled={busy}
                onClick={async () => {
                  const removed = image.itemId
                    ? await onRemovePendingSource?.(image.itemId)
                    : await onRemoveSource(image.id);
                  if (removed) pages.back();
                }}
              >
                Remove Screenshot
              </Button>
            </>
          ) : page.kind === "name" ? (
            <NameCorrection
              key={`${image.id}-${page.row}`}
              mogi={mogi}
              captureId={image.id}
              row={page.row}
              busy={busy}
              onUpdate={onUpdate}
              onDone={pages.back}
            />
          ) : page.kind === "race" ? (
            <List aria-label="Race number">
              {Array.from({ length: 12 }, (_, i) => (
                <ListRow
                  key={i}
                  disabled={busy}
                  accessory={image.number === i + 1 ? "check" : undefined}
                  onSelect={() => void assign(i + 1)}
                >
                  Race {i + 1}
                </ListRow>
              ))}
              <ListRow disabled={busy} onSelect={() => void assign(null)}>
                Not Assigned
              </ListRow>
            </List>
          ) : (
            <List aria-label="Numbers read">
              {capture?.numericRows?.map((row) => (
                <ListRow
                  key={row.row}
                  description={capture.rows[row.row - 1]?.text}
                  trail={[row.right.text || "—", row.addition.text].filter(Boolean).join(" · ")}
                >
                  Row {row.row}
                </ListRow>
              ))}
            </List>
          )
        ) : null}
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
