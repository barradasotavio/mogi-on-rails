"use client";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { type AutomaticBackup, backupDate, backupSize, listAutomaticBackups } from "@/lib/backup/automatic";

export function AutomaticBackups({ onSelect }: { onSelect: (entry: AutomaticBackup) => void }) {
  const [entries, setEntries] = useState<AutomaticBackup[]>([]);
  const [problem, setProblem] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void listAutomaticBackups().then(
      (backups) => {
        if (!cancelled) {
          setEntries(backups);
          setLoaded(true);
        }
      },
      () => {
        if (!cancelled) setProblem(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <ListGroup title="Before updates" note="Saved on this device before each update. The latest 3 are kept.">
      {problem ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn't open automatic backups. Try reopening Settings.</AlertDescription>
        </Alert>
      ) : entries.length ? (
        <List aria-label="Before updates">
          {entries.map((entry) => (
            <ListRow
              key={entry.id}
              accessory="chevron"
              onSelect={() => onSelect(entry)}
              description={`${entry.mogiCount} ${entry.mogiCount === 1 ? "mogi" : "mogis"} · ${backupSize(entry.size)}`}
            >
              {backupDate(entry.createdAt)}
            </ListRow>
          ))}
        </List>
      ) : (
        <List aria-label="Before updates" tone="muted">
          <ListRow>{loaded ? "None yet" : "Loading backups…"}</ListRow>
        </List>
      )}
    </ListGroup>
  );
}
