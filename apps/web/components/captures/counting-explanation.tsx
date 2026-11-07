import { List, ListGroup, ListRow } from "@/components/ui/list";
import { captureExplanationLines } from "@/lib/mogi/capture-explanation";
import type { Mogi } from "@/lib/mogi/types";

export function CountingExplanation({
  mogi,
  captureId,
  busy,
  onRace,
  onName,
  onQuestion,
}: {
  mogi: Mogi;
  captureId: string;
  busy: boolean;
  onRace: () => void;
  onName: (row: number) => void;
  onQuestion: (id: string) => void;
}) {
  const lines = captureExplanationLines(mogi, captureId);
  if (!lines.length) return null;
  return (
    <ListGroup title="How this was counted">
      <List dividers="row" aria-label="How this was counted">
        {lines.map((line, index) => {
          const label = [line.decision, line.reason, line.origin].filter(Boolean).join(", ");
          const onSelect =
            line.kind === "race"
              ? onRace
              : line.kind === "name" && line.row
                ? () => onName(line.row!)
                : line.kind === "pending" && line.questionId
                  ? () => onQuestion(line.questionId!)
                  : undefined;
          return (
            <ListRow
              key={`${line.rule}-${index}`}
              wrap
              aria-label={label}
              description={line.origin && line.reason ? line.reason : undefined}
              trail={line.origin ?? line.reason}
              onSelect={onSelect}
              accessory={line.kind === "pending" ? "chevron" : undefined}
              disabled={busy}
              buttonProps={onSelect ? { "aria-label": label } : undefined}
            >
              {line.decision}
            </ListRow>
          );
        })}
      </List>
    </ListGroup>
  );
}
