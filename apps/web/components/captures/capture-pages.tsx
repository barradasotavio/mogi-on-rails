"use client";

import { screens, type SequenceAnswer, sequenceInputSignature } from "@mkw/engine";
import type { ReactNode } from "react";

import { CaptureImage, CaptureThumbnail } from "@/components/captures/capture-image";
import { CountingExplanation } from "@/components/captures/counting-explanation";
import { NameCorrection } from "@/components/name-correction";
import { Button } from "@/components/ui/button";
import { List, ListRow } from "@/components/ui/list";
import { captureRace, imageLabel, imageMoment, imageRace } from "@/lib/mogi/capture-label";
import type { Mogi, SharedFile } from "@/lib/mogi/types";

/** A page of the screenshots task: the list, one screenshot's detail, and the detail's own pages. */
export type CapturePage =
  { kind: "list" } | { kind: "image" | "race" | "numbers"; id: string } | { kind: "name"; id: string; row: number };

/** The mogi's screenshots, saved ones first, then the pending review's files that weren't saved. */
export function captureEntries(mogi: Mogi, pendingFiles: SharedFile[] = []) {
  return [
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
}

/**
 * The screenshots task as pages of whichever sheet holds it: Mogi Settings lists them all, the race sheet only its
 * race's (`raceId`). The sheet keeps the page stack and gives `push` and `back`; this gives each page's title, a
 * `key` for the sheet's `page`, and its content. Removing a screenshot goes back one page; a race that a removal
 * drops leaves its list empty.
 */
export function capturePages({
  mogi,
  pendingFiles,
  raceId,
  page,
  busy,
  push,
  back,
  onUpdate,
  onRemoveSource,
  onRemovePendingSource,
  onSequenceAnswer,
  onQuestion,
}: {
  mogi: Mogi;
  pendingFiles?: SharedFile[];
  /** Lists only this race's screenshots (`captureRace`), pre-race and repeats included. */
  raceId?: string;
  page: CapturePage;
  busy: boolean;
  push: (page: CapturePage) => void;
  back: () => void;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onRemoveSource: (id: string) => Promise<boolean>;
  onRemovePendingSource?: (id: string) => Promise<boolean>;
  onSequenceAnswer: (answer: SequenceAnswer, signature: string) => Promise<boolean>;
  onQuestion: (id: string) => void;
}): { title: string; key: string; content: ReactNode } {
  const entries = captureEntries(mogi, pendingFiles);
  if (page.kind === "list") {
    const listed = raceId
      ? entries.filter((entry) => entry.capture && captureRace(mogi, entry.capture)?.id === raceId)
      : entries;
    return {
      title: "Screenshots",
      key: "images",
      content: (
        <List aria-label={raceId ? "Race screenshots" : "Mogi screenshots"}>
          {listed.map((entry) => (
            <ListRow
              key={entry.id}
              media={<CaptureThumbnail original={entry.original} />}
              description={entry.fileName}
              accessory="chevron"
              onSelect={() => push({ kind: "image", id: entry.id })}
            >
              {imageLabel(entry.number, entry.capture)}
            </ListRow>
          ))}
        </List>
      ),
    };
  }
  const image = entries.find((entry) => entry.id === page.id);
  const capture = image?.capture;
  const title =
    page.kind === "name"
      ? (mogi.participants.find((p) => p.id === capture?.nameAssociations?.[page.row - 1]?.participantId)?.loungeName ??
        "Name")
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
      back();
  }
  const content = !image ? null : page.kind === "image" ? (
    <>
      <CaptureImage original={image.original} alt={image.fileName} label={imageLabel(image.number, capture)} />
      {image.failed && <p className="text-sm text-muted-foreground">Reading failed</p>}
      <List dividers="row">
        <ListRow
          disabled={!capture || busy}
          accessory="chevron"
          trail={image.number ?? "Not Assigned"}
          onSelect={() => push({ kind: "race", id: image.id })}
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
          onRace={() => push({ kind: "race", id: image.id })}
          onName={(row) => push({ kind: "name", id: image.id, row })}
          onQuestion={onQuestion}
        />
      )}
      {/* A pending or older capture may have no numbers read, and an empty page is not offered. */}
      {!!capture?.numericRows?.length && (
        <List dividers="row">
          <ListRow accessory="chevron" onSelect={() => push({ kind: "numbers", id: image.id })}>
            Numbers Read
          </ListRow>
        </List>
      )}
      <Button
        variant="destructive-ghost"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          const removed = image.itemId ? await onRemovePendingSource?.(image.itemId) : await onRemoveSource(image.id);
          if (removed) back();
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
      onDone={back}
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
  );
  return { title, key: `${page.kind}-${"id" in page ? page.id : ""}`, content };
}
