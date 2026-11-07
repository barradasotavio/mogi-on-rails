"use client";
import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { type AutomaticBackup, backupDate, backupSize, listAutomaticBackups } from "@/lib/backup/automatic";

export function AutomaticBackups({ onSelect }: { onSelect: (entry: AutomaticBackup) => void }) {
  const [entries, setEntries] = useState<AutomaticBackup[]>([]);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void listAutomaticBackups().then(
      (backups) => {
        if (!cancelled) setEntries(backups);
      },
      () => {
        if (!cancelled) setProblem(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (problem)
    return (
      <ListGroup title="Before updates">
        <Alert variant="destructive">
          <AlertDescription>Couldn't open automatic backups. Try reopening Settings.</AlertDescription>
        </Alert>
      </ListGroup>
    );
  // Hidden while empty: the group appears with the first backup an update saves.
  if (!entries.length) return null;
  return (
    <ListGroup title="Before updates">
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
    </ListGroup>
  );
}
