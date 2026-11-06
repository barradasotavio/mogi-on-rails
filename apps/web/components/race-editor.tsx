"use client";

import {
  individualStandings,
  initialRaceReview,
  nativePlacementPoints,
  participationSlot,
  placementPoints,
  raceNumber,
  raceNumbers,
  reviewedRace,
  screenProperties,
} from "@mkw/engine";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { CaptureImage } from "@/components/captures/capture-image";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { useSheetPage } from "@/components/ui/sheet";
import { ordinal } from "@/lib/format";
import type { Mogi, Race, RaceReviewFields } from "@/lib/mogi/types";
import { settled } from "@/lib/settled";

type Page = { kind: "result" } | { kind: "place"; position: number } | { kind: "absent" } | { kind: "points" };

const invalidPoints = (value: string | undefined) =>
  value !== undefined &&
  (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 15);

/**
 * Edit Result, as pages of the race sheet: the finish order is a grouped list, each place opens a page
 * of players and choosing one swaps the two places. Absent players and in-game points sit under
 * More options, always shown. Saving is the review: there is no separate "I checked" step.
 * In a race no screenshot shows, each place shows the player's total after this race, so a result typed by
 * hand can be checked against the game's totals.
 */
export function RaceEditor({
  mogi,
  race,
  onSave,
  onBack,
  busy,
  initialFields,
  onDraftChange,
  draftError = false,
  confirmationDisabled = false,
  reviewContext,
}: {
  mogi: Mogi;
  race: Race;
  onSave: (race: Race) => Promise<unknown>;
  /** Back from the result page, when it leads somewhere other than the race, such as Review Screenshot. */
  onBack?: () => void;
  busy: boolean;
  initialFields?: RaceReviewFields;
  onDraftChange?: (fields: RaceReviewFields) => void;
  draftError?: boolean;
  confirmationDisabled?: boolean;
  reviewContext?: ReactNode;
}) {
  const [page, setPage] = useState<Page>({ kind: "result" });
  const participants = mogi.participants;
  const capture = mogi.captures?.find(
    (c) =>
      race.captureIds?.includes(c.id) &&
      c.stage === "finish-order-confirmed" &&
      (!c.interpretation || screenProperties(c.interpretation.screen).order === "finishOrder"),
  );
  // A screenshot the recognizer couldn't read stays the race's reference.
  const unread = capture
    ? undefined
    : mogi.captures?.find((c) => race.captureIds?.includes(c.id) && c.interpretation?.screen === "unknown");
  const [fields, setFields] = useState(() => initialFields ?? initialRaceReview(race));
  const { placements, rawOverrides } = fields;
  const absent = fields.absentParticipantIds;
  const name = (id: string) => participants.find((person) => person.id === id)?.loungeName ?? "Unknown player";
  function change(next: RaceReviewFields) {
    setFields(next);
    onDraftChange?.(next);
  }
  const visiblePlacements = Array.from({ length: 12 - absent.length }, (_, index) => placements[index] ?? "");
  const nativeScale = nativePlacementPoints(placements.length);
  const unreadable =
    capture?.unreadableRowNumbers ?? capture?.rows.flatMap((row, n) => (row.text.trim() ? [] : [n + 1])) ?? [];
  const suggestions = capture?.possibleAbsentParticipantIds ?? [];
  // With every earlier race proven, a typed place shows the total it leads to, as the game's totals column does.
  const number = raceNumber(mogi, race);
  const earlier = raceNumbers().filter((entry) => entry < number);
  const before = !capture ? individualStandings(mogi, { through: number - 1 }) : [];
  const provenBefore =
    before.length > 0 &&
    before.every((row) => row.points !== null && earlier.every((entry) => row.coverage.includes(entry)));
  const totalAfter = (id: string, position: number) => {
    const person = participants.find((entry) => entry.id === id);
    const previous = person && before.find((row) => row.id === participationSlot(person))?.points;
    return provenBefore && typeof previous === "number" ? previous + placementPoints[position] : undefined;
  };
  const rawMismatch = placements.some(
    (id, position) => rawOverrides[id] !== undefined && Number(rawOverrides[id]) !== nativeScale[position],
  );
  const validatedRace = reviewedRace(race, fields, participants);
  // Draft writes don't make the editor busy, so Save Result guards its own write against a second tap.
  const [saving, setSaving] = useState(false);
  const canSave = !busy && !saving && !confirmationDisabled && !!validatedRace;
  const back = () => setPage({ kind: "result" });
  const title =
    page.kind === "place"
      ? `${ordinal(page.position + 1)} Place`
      : page.kind === "absent"
        ? "Absent Players"
        : page.kind === "points"
          ? "In-Game Points and Adjustments"
          : "Edit Result";
  const footer = useSheetPage({
    page: page.kind === "place" ? `place-${page.position}` : page.kind,
    title,
    footer: page.kind === "result",
    onBack: page.kind === "result" ? onBack : back,
    depth: (onBack ? 1 : 0) + (page.kind === "result" ? 0 : 1),
  });
  function choose(position: number, id: string) {
    const previousPosition = placements.indexOf(id);
    const next = [...placements];
    next[position] = id;
    if (previousPosition !== -1) next[previousPosition] = placements[position];
    change({ ...fields, placements: next, reviewed: false });
    back();
  }
  function toggleAbsent(id: string) {
    change({
      ...fields,
      absentParticipantIds: absent.includes(id) ? absent.filter((item) => item !== id) : [...absent, id],
      placements: absent.includes(id) ? [...placements, id] : placements.filter((item) => item !== id),
      reviewed: false,
    });
  }
  async function save() {
    if (!canSave || !validatedRace) return;
    setSaving(true);
    await settled(
      () => onSave(validatedRace),
      () => setSaving(false),
    );
  }

  if (page.kind === "place") {
    const current = visiblePlacements[page.position];
    return (
      <ListGroup note={current ? "Choosing a player swaps their places." : undefined}>
        <List dividers="row" aria-label={`Players for ${ordinal(page.position + 1)} place`}>
          {participants
            .filter((person) => !absent.includes(person.id))
            // In finish order, then anyone without a place.
            .sort((a, b) => ((placements.indexOf(a.id) + 13) % 13) - ((placements.indexOf(b.id) + 13) % 13))
            .map((person) => {
              const at = placements.indexOf(person.id);
              // An empty place takes only a player without a place, so no other place empties.
              return (
                <ListRow
                  key={person.id}
                  disabled={busy || (!current && at !== -1)}
                  accessory={person.id === current ? "check" : undefined}
                  trail={person.id !== current && at !== -1 ? ordinal(at + 1) : undefined}
                  onSelect={() => choose(page.position, person.id)}
                >
                  {person.loungeName}
                </ListRow>
              );
            })}
        </List>
      </ListGroup>
    );
  }
  if (page.kind === "absent")
    return (
      <>
        <ListGroup note="Absent players are missing from the results screen and get 1 point each. A disconnect isn't an absence, since the CPU still finishes under the player's name, and neither is an unread name.">
          <List dividers="row" aria-label="Absent players">
            {participants.map((person) => (
              <ListRow
                key={person.id}
                disabled={busy || (!absent.includes(person.id) && absent.length >= 2)}
                description={suggestions.includes(person.id) ? "Possibly absent" : undefined}
                accessory={absent.includes(person.id) ? "check" : undefined}
                buttonProps={{ "aria-pressed": absent.includes(person.id) }}
                onSelect={() => toggleAbsent(person.id)}
              >
                {person.loungeName}
              </ListRow>
            ))}
          </List>
        </ListGroup>
      </>
    );
  if (page.kind === "points")
    return (
      <>
        {rawMismatch && (
          <Alert>
            <AlertDescription>
              These points differ from the usual in-game scale. Lounge points stay the same; check the screenshot.
            </AlertDescription>
          </Alert>
        )}
        <ListGroup note="Only for a results screen whose in-game points differ from the usual scale. Lounge points follow the finish order.">
          <List dividers="row" aria-label="In-game points">
            {placements.map((id, position) => {
              const invalid = invalidPoints(rawOverrides[id]);
              return (
                <ListRow
                  key={id}
                  lead={position + 1}
                  description={
                    invalid ? "Enter a whole number from 0 to 15." : `${placementPoints[position]} Lounge points`
                  }
                  trail={
                    <Input
                      variant="filled"
                      className="w-16 text-right"
                      aria-label={`In-game points for ${ordinal(position + 1)} place`}
                      aria-invalid={invalid}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={2}
                      disabled={busy}
                      value={rawOverrides[id] ?? String(nativeScale[position] ?? 0)}
                      onChange={(event) =>
                        change({
                          ...fields,
                          rawOverrides: { ...rawOverrides, [id]: event.target.value },
                          reviewed: false,
                        })
                      }
                    />
                  }
                >
                  {name(id)}
                </ListRow>
              );
            })}
          </List>
        </ListGroup>
      </>
    );

  const reading = (position: number, id: string) => {
    if (!capture) return undefined;
    const text = capture.rows[position]?.text.trim();
    if (!text) return "Name not read";
    const person = participants.find((entry) => entry.id === id);
    return person && [person.ign, person.loungeName].some((known) => known?.toLowerCase() === text.toLowerCase())
      ? undefined
      : `Read as “${text}”`;
  };
  return (
    <>
      {footer &&
        createPortal(
          <GlassButton tint className="w-full" disabled={!canSave} onClick={() => void save()}>
            Save Result
          </GlassButton>,
          footer,
        )}
      {capture && <CaptureImage key={capture.id} original={capture.original} />}
      {!capture && unread && (
        <CaptureImage key={unread.id} original={unread.original} alt={`Screenshot of race ${number}`} />
      )}
      {reviewContext}
      {draftError && onDraftChange && (
        <div className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertDescription>The edit in progress wasn&apos;t kept on this device.</AlertDescription>
          </Alert>
          <Button
            variant="outline"
            aria-label="Try Saving the Draft Again"
            disabled={busy}
            onClick={() => onDraftChange(fields)}
          >
            Try Again
          </Button>
        </div>
      )}
      {!validatedRace && (
        <Alert variant="destructive">
          <AlertDescription>Fill every place to save. The previous result stays until then.</AlertDescription>
        </Alert>
      )}
      {unreadable.length > 2 && (
        <Alert>
          <AlertDescription>
            {unreadable.length} names weren&apos;t read. That doesn&apos;t mean {unreadable.length} players
            disconnected. If this isn&apos;t a results screen, go back and choose another screenshot.
          </AlertDescription>
        </Alert>
      )}
      <ListGroup
        title="Finish order"
        note={
          capture
            ? "Check each place against the screenshot."
            : provenBefore
              ? "Beside each place's points, the player's total after this race."
              : undefined
        }
      >
        <List dividers="row" aria-label="Finish order">
          {visiblePlacements.map((id, position) => (
            <ListRow
              key={position}
              lead={position + 1}
              accessory="chevron"
              disabled={busy || position > placements.length}
              description={id ? reading(position, id) : undefined}
              trail={
                id && totalAfter(id, position) !== undefined
                  ? `+${placementPoints[position]} · ${totalAfter(id, position)}`
                  : `+${placementPoints[position]}`
              }
              buttonProps={{
                "aria-label": `${position + 1}, ${id ? name(id) : "Choose player"}${id && totalAfter(id, position) !== undefined ? `, ${totalAfter(id, position)} after this race` : ""}`,
              }}
              onSelect={() => setPage({ kind: "place", position })}
            >
              {id ? name(id) : <span className="text-muted-foreground">Choose player</span>}
            </ListRow>
          ))}
        </List>
      </ListGroup>
      {absent.length > 0 && (
        <ListGroup title="Absent">
          <List dividers="row" aria-label="Absent">
            {absent.map((id) => (
              <ListRow key={id} lead="—" trail="+1">
                {name(id)}
              </ListRow>
            ))}
          </List>
        </ListGroup>
      )}
      <ListGroup title="More options">
        <List dividers="row" aria-label="More options">
          <ListRow
            accessory="chevron"
            disabled={busy}
            trail={absent.length || undefined}
            onSelect={() => setPage({ kind: "absent" })}
          >
            Absent Players
          </ListRow>
          <ListRow
            accessory="chevron"
            disabled={busy}
            trail={Object.keys(rawOverrides).length ? "Edited" : undefined}
            onSelect={() => setPage({ kind: "points" })}
          >
            In-Game Points and Adjustments
          </ListRow>
        </List>
      </ListGroup>
    </>
  );
}
