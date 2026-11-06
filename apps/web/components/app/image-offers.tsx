"use client";

import { mogiOverview } from "@mkw/engine";
import { useEffect, useRef, useState } from "react";

import { inspectPaste, type Paste, PastedScreenshotsSheet } from "@/components/captures/pasted-screenshots";
import { knownOriginals } from "@/lib/images/gallery";
import { readPhotoMoment } from "@/lib/images/photo-moment";
import { type FolderImage, markOffered, readWatchedFolders } from "@/lib/images/watched-folders";
import type { Mogi, TrackerState } from "@/lib/mogi/types";

import { useFolderWatch, type useWatchedFolders } from "./watched-folders";

/**
 * Images offered to the open mogi from outside the picker: pasted screenshots and new images in the
 * watched folders. Nothing is stored before Add to Mogi in the confirmation sheet.
 */
export function ImageOffers({
  mogi,
  shown,
  sheetOpen,
  busy,
  watched,
  current,
  onAdd,
}: {
  /** The mogi on screen, which receives the images. */
  mogi: Mogi | undefined;
  /** The mogi's screen is the one shown. */
  shown: boolean;
  /** Settings or New Mogi is open: a paste belongs to them. */
  sheetOpen: boolean;
  busy: boolean;
  watched: ReturnType<typeof useWatchedFolders>;
  current: () => TrackerState;
  onAdd: (files: File[], pastedAt?: number) => void;
}) {
  const [paste, setPaste] = useState<Paste | null>(null);
  const pasteTrigger = useRef<HTMLElement | null>(null);
  // The folder images the open confirmation shows: offered once, whichever way it closes.
  const folderOffer = useRef<FolderImage[]>([]);
  useEffect(() => {
    function paste(event: ClipboardEvent) {
      if (!shown || !mogi) return;
      if (
        sheetOpen ||
        document.querySelector(
          '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])',
        )
      )
        return;
      if (document.activeElement?.closest("input, textarea, [contenteditable]")) return;
      const imageTypes = ["image/png", "image/jpeg", "image/webp"];
      let files = Array.from(event.clipboardData?.files ?? []).filter((file) => imageTypes.includes(file.type));
      if (!files.length)
        files = Array.from(event.clipboardData?.items ?? [])
          .filter((item) => item.kind === "file" && imageTypes.includes(item.type))
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null);
      if (!files.length) return;
      event.preventDefault();
      const pastedAt = Date.now();
      const time = new Date(pastedAt);
      const label = [time.getHours(), time.getMinutes(), time.getSeconds()]
        .map((value) => String(value).padStart(2, "0"))
        .join("-");
      const named = files.map(
        (file, index) =>
          new File(
            [file],
            readPhotoMoment(new Uint8Array(), file.name)
              ? file.name
              : `Pasted screenshot ${label}${index ? ` ${index + 1}` : ""}.${file.type.split("/")[1]}`,
            { type: file.type, lastModified: pastedAt + index },
          ),
      );
      pasteTrigger.current = document.activeElement as HTMLElement | null;
      void inspectPaste(named, knownOriginals(current(), mogi.id), pastedAt).then(setPaste);
    }
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [shown, mogi, sheetOpen, current]);
  const closeFolderOffer = async (shownImages?: FolderImage[]) => {
    const images = shownImages ?? folderOffer.current;
    folderOffer.current = [];
    if (!images.length) return;
    await markOffered(images);
    watched.setFolders(await readWatchedFolders());
  };
  useFolderWatch(
    watched.folders,
    shown && mogi && !mogiOverview(mogi).finished ? Date.parse(mogi.createdAt) : null,
    async (images) => {
      if (!mogi) return;
      const offer = await inspectPaste(
        images.map((image) => image.file),
        knownOriginals(current(), mogi.id),
      );
      // Only images already stored: nothing to add, so nothing to ask.
      if (offer.shots.every((shot) => shot.repeated !== undefined)) return closeFolderOffer(images);
      folderOffer.current = images;
      pasteTrigger.current = document.activeElement as HTMLElement | null;
      setPaste(offer);
    },
  );
  return (
    <PastedScreenshotsSheet
      paste={paste}
      busy={busy}
      onOpenChange={(open) => {
        if (!open) {
          setPaste(null);
          void closeFolderOffer();
        }
      }}
      onAdd={(files, pastedAt) => {
        setPaste(null);
        void closeFolderOffer();
        onAdd(files, pastedAt);
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (pasteTrigger.current?.isConnected) pasteTrigger.current.focus({ preventScroll: true });
      }}
    />
  );
}
