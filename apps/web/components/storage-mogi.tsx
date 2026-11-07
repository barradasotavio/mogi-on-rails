"use client";

import { useRef, useState } from "react";

import { mogiTitle } from "@/components/mogi-overview";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import type { Mogi } from "@/lib/mogi/types";
import { formatBytes, mogiStorageSize } from "@/lib/storage/usage";

export function StorageMogi({
  mogi,
  busy,
  onDeleteImages,
  onDelete,
}: {
  mogi: Mogi;
  busy: boolean;
  onDeleteImages: () => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState<"images" | "mogi" | null>(null);
  const deleteMogi = useRef<HTMLButtonElement>(null);
  const deleteImages = useRef<HTMLButtonElement>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const hasImages = (mogi.captures ?? []).some((image) => image.original !== null);
  return (
    <>
      <ListGroup>
        <List aria-label="Size">
          <ListRow trail={formatBytes(mogiStorageSize(mogi))}>Size</ListRow>
        </List>
      </ListGroup>
      <ListGroup>
        <List aria-label="Actions">
          {hasImages && (
            <ListRow
              action="primary"
              buttonProps={{ ref: deleteImages }}
              disabled={busy}
              onSelect={() => {
                confirmationTrigger.current = deleteImages.current;
                setConfirm("images");
              }}
            >
              Delete Screenshots
            </ListRow>
          )}
          <ListRow
            action="destructive"
            buttonProps={{ ref: deleteMogi }}
            disabled={busy}
            onSelect={() => {
              confirmationTrigger.current = deleteMogi.current;
              setConfirm("mogi");
            }}
          >
            Delete Mogi
          </ListRow>
        </List>
      </ListGroup>
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        busy={busy}
        title={confirm === "images" ? `Delete Screenshots of ${mogiTitle(mogi)}?` : `Delete ${mogiTitle(mogi)}?`}
        description={confirm === "images" ? "Results and the table are kept." : "This can't be undone."}
        confirmLabel={confirm === "images" ? "Delete Screenshots" : "Delete Mogi"}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = confirmationTrigger.current?.isConnected ? confirmationTrigger.current : deleteMogi.current;
          if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        }}
        onConfirm={confirm === "images" ? onDeleteImages : onDelete}
      />
    </>
  );
}
