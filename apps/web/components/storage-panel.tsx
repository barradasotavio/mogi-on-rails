"use client";
import { mogiOverview, mogiSummary } from "@mkw/engine";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { List, ListGroup, ListRow } from "@/components/ui/list";
import { Meter } from "@/components/ui/meter";
import type { Mogi } from "@/lib/mogi/types";
import { formatBytes, mogiStorageSize, storageEstimate, storagePersisted } from "@/lib/storage/usage";

interface StorageRow {
  size: number;
  summary: string;
  finished: boolean;
}
// Saves replace only the mogis they change, so an unchanged mogi keeps its row when Storage opens again, such as
// on the way back from a mogi's page: the projection behind each row is the slow part.
const rows = new WeakMap<Mogi, StorageRow>();
function storageRow(mogi: Mogi): StorageRow {
  let row = rows.get(mogi);
  if (!row)
    rows.set(
      mogi,
      (row = { size: mogiStorageSize(mogi), summary: mogiSummary(mogi).text, finished: mogiOverview(mogi).finished }),
    );
  return row;
}
// The last reading shows at once on the next open while a fresh one is taken.
let lastEstimate: { usage: number; quota: number } | null | undefined;
let lastPersisted: boolean | undefined;

/** Settings › Storage: what the app uses, its backup and restore, what takes the space, and whether the browser keeps it. */
export function StoragePanel({
  mogis,
  backup,
  onOpenMogi,
}: {
  mogis: Mogi[];
  onOpenMogi: (id: string) => void;
  /** The Backup group and the automatic backups, from the backup controller. */
  backup: ReactNode;
}) {
  const [estimate, setEstimate] = useState(lastEstimate);
  const [persisted, setPersisted] = useState(lastPersisted);
  useEffect(() => {
    let cancelled = false;
    void storageEstimate().then((value) => {
      lastEstimate = value;
      if (!cancelled) setEstimate(value);
    });
    void storagePersisted().then((value) => {
      lastPersisted = value;
      if (!cancelled) setPersisted(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const sized = useMemo(
    () => mogis.map((mogi) => ({ mogi, ...storageRow(mogi) })).sort((a, b) => b.size - a.size),
    [mogis],
  );
  const used = estimate && `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used`;

  return (
    <div className="section-stack">
      <ListGroup title="Usage">
        <List aria-label="Usage">
          {estimate === undefined ? (
            <ListRow>Checking usage…</ListRow>
          ) : estimate && used ? (
            <ListRow>
              <span className="flex flex-col gap-2 py-2">
                <span>{used}</span>
                <Meter label="Storage used" value={estimate.usage} max={estimate.quota} valueText={used} />
              </span>
            </ListRow>
          ) : (
            <ListRow wrap>Usage isn&apos;t available in this browser.</ListRow>
          )}
        </List>
      </ListGroup>
      {backup}
      <ListGroup title="Mogis">
        {sized.length ? (
          <List aria-label="Mogis">
            {sized.map(({ mogi, size, summary, finished }) => (
              <ListRow
                key={mogi.id}
                description={summary}
                trail={formatBytes(size)}
                accessory={finished ? "chevron" : undefined}
                onSelect={finished ? () => onOpenMogi(mogi.id) : undefined}
              >
                Mogi Tier {mogi.submissionTier?.trim() || "—"} · {mogi.format}
              </ListRow>
            ))}
          </List>
        ) : (
          <List aria-label="Mogis" tone="muted">
            <ListRow>No mogis yet</ListRow>
          </List>
        )}
      </ListGroup>
      <ListGroup title="Persistent storage" note="When it's off, the browser may clear your mogis to free space.">
        <List aria-label="Persistent storage">
          <ListRow trail={persisted === undefined ? "…" : persisted ? "On" : "Off"}>Status</ListRow>
        </List>
      </ListGroup>
    </div>
  );
}
