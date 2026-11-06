"use client";

import type { TeamTag } from "@mkw/engine";
import {
  changeIgn,
  individualStandings,
  inferTeamTags,
  participantSynonyms,
  participationMembers,
  participationSlot,
  registerSubstitution,
  resultCoverage,
  rosterSlots,
  teamLabel,
  unlinkSynonym,
} from "@mkw/engine";
import { type FormEvent, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChoiceGrid } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { Sheet, usePageStack } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ordinal } from "@/lib/format";
import { substitutionEntryLabel } from "@/lib/mogi/race-label";
import type { Mogi, Participant } from "@/lib/mogi/types";

import { NameReading } from "./name-correction";
import { TeamMark } from "./team-mark";

type PlayerPage = { kind: "list" } | { kind: "person" | "sub" | "team"; id: string };
export type PlayerShortcut = { kind: "person" | "team"; id: string };
type PlayerProps = {
  mogi: Mogi;
  busy: boolean;
  onIgnChange: (person: Participant, ign: string) => Promise<boolean>;
};

export function MogiPlayers({
  mogi,
  busy,
  onIgnChange,
  onUpdate,
  open,
  start,
  onOpenChange,
  onCloseAutoFocus,
  onCredit,
}: PlayerProps & {
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  open: boolean;
  /** Opens on this player or team alone, as from a Standings row. */
  start?: PlayerShortcut;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  onCredit: (slot: string) => Promise<boolean>;
}) {
  const pages = usePageStack<PlayerPage>({ kind: "list" });
  const toast = useToast();
  const page = pages.page;
  const person =
    page.kind === "person" || page.kind === "sub"
      ? mogi.participants.find((person) => person.id === page.id)
      : undefined;
  const tags = inferTeamTags(mogi);
  const team = page.kind === "team" ? tags.find((team) => team.teamId === page.id) : undefined;
  // Asks without blocking anything: teams whose tag couldn't be read from the in-game names.
  const untagged = tags.filter((team) => !team.tag && !team.chosen);
  const members = (teamId: string) => rosterSlots(mogi).filter((person) => person.teamId === teamId);
  const roster = (
    <List aria-label="Player list">
      {rosterSlots(mogi).flatMap((slot, index) =>
        participationMembers(mogi, slot.id).map((person) => {
          const outgoing = mogi.substitutions?.find((entry) => entry.outgoingParticipantId === person.id);
          const incoming = mogi.substitutions?.find((entry) => entry.incomingParticipantId === person.id);
          const from = incoming?.fromRace ?? 1;
          const through = outgoing ? outgoing.fromRace - 1 : 12;
          const igns = [...new Set([person.ign, ...participantSynonyms(mogi, person.id)])].filter(
            (name) => name && name !== person.loungeName,
          );
          return (
            <ListRow
              key={person.id}
              lead={person.id === slot.id ? index + 1 : ""}
              accessory="chevron"
              trail={
                (incoming || outgoing) && (
                  <span className="whitespace-nowrap text-xs">
                    {through < from ? "No races" : `Races ${from}–${through}`}
                  </span>
                )
              }
              buttonProps={{ "aria-label": person.loungeName }}
              onSelect={() => pages.push({ kind: "person", id: person.id })}
            >
              <span className="flex min-w-0 items-center gap-2">
                {mogi.format !== "FFA" && <TeamMark mogi={mogi} id={person.teamId} />}
                <span className="truncate">
                  {person.loungeName}
                  {igns.length > 0 && <span className="text-sm text-muted-foreground"> {igns.join(" · ")}</span>}
                </span>
              </span>
            </ListRow>
          );
        }),
      )}
    </List>
  );
  // Each opening starts on the list, or alone on the page asked for, which then just closes; closing keeps the page during the exit animation.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) pages.reset(start);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      kind="detail"
      title={page.kind === "sub" ? "Sub" : team ? teamLabel(mogi, team.teamId) : (person?.loungeName ?? "Players")}
      page={page.kind === "list" ? "list" : `${page.kind}-${page.id}`}
      onBack={pages.depth > 1 ? pages.back : undefined}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {team ? (
        <TeamPage
          key={team.teamId}
          mogi={mogi}
          team={team}
          members={members(team.teamId)}
          busy={busy}
          onUpdate={onUpdate}
          onOpen={(id) => pages.push({ kind: "person", id })}
        />
      ) : person && page.kind === "sub" ? (
        <SubstitutionForm
          mogi={mogi}
          person={person}
          busy={busy}
          onUpdate={onUpdate}
          onSaved={(name, from) => {
            pages.reset();
            toast(`${name} subs in from race ${from}`);
          }}
        />
      ) : person ? (
        <Person
          key={person.id}
          mogi={mogi}
          person={person}
          busy={busy}
          onIgnChange={onIgnChange}
          onUpdate={onUpdate}
          onSub={() => pages.push({ kind: "sub", id: person.id })}
          onTeam={(id) => pages.push({ kind: "team", id })}
          onCredit={onCredit}
        />
      ) : (
        <>
          {untagged.length > 0 && (
            <ListGroup title="Teams without a tag">
              <List aria-label="Teams without a tag">
                {untagged.map((team) => (
                  <ListRow
                    key={team.teamId}
                    lead={<TeamMark mogi={mogi} id={team.teamId} />}
                    trail="Set"
                    accessory="chevron"
                    description={
                      team.inferred
                        ? `Another team also seems to use ${team.inferred}`
                        : "Their in-game names share no tag"
                    }
                    onSelect={() => pages.push({ kind: "team", id: team.teamId })}
                  >
                    {members(team.teamId)
                      .map((person) => person.loungeName)
                      .join(", ")}
                  </ListRow>
                ))}
              </List>
            </ListGroup>
          )}
          {/* Under another titled section the roster needs its own title; alone, the sheet's title names it. */}
          {untagged.length > 0 ? <ListGroup title="Players">{roster}</ListGroup> : roster}
        </>
      )}
    </Sheet>
  );
}

function Person({
  mogi,
  person,
  busy,
  onIgnChange,
  onUpdate,
  onSub,
  onTeam,
  onCredit,
}: PlayerProps & {
  person: Participant;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onSub: () => void;
  onTeam: (id: string) => void;
  onCredit: (slot: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const team = inferTeamTags(mogi).find((team) => team.teamId === person.teamId);
  const [ign, setIgn] = useState(person.ign);
  const [error, setError] = useState("");
  const standing = individualStandings(mogi).find((row) => row.id === participationSlot(person));
  const substitutions =
    mogi.substitutions?.filter(
      (entry) => entry.outgoingParticipantId === person.id || entry.incomingParticipantId === person.id,
    ) ?? [];
  const count = resultCoverage(mogi).included.length;
  const synonyms = participantSynonyms(mogi, person.id);
  // Reuses the existing label to tell an inference from the user's answer.
  const suggested = (synonym: string) =>
    mogi.captures?.some((capture) =>
      capture.nameAssociations?.some(
        (answer, index) =>
          answer.participantId === person.id &&
          answer.origin === "deduced" &&
          (answer.ign ?? capture.rows[index]?.text)?.trim() === synonym,
      ),
    );
  const slot = participationSlot(person);
  const credited =
    participationMembers(mogi, slot).length > 1
      ? mogi.participants.find((person) => person.id === mogi.creditedParticipantIds?.[slot])
      : undefined;
  // Undoing the synonym returns every occurrence of that spelling to the queue.
  async function unlink(synonym: string) {
    setError("");
    if (await onUpdate(unlinkSynonym(mogi, person.id, synonym))) toast(`“${synonym}” will be asked again`);
    else setError("Couldn't unlink this reading. Try again.");
  }
  async function saveIgn() {
    const value = ign.trim();
    // The same name still saves when some capture links its spelling to someone else.
    const links = (state: Mogi) => JSON.stringify(state.captures?.map((capture) => capture.nameAssociations));
    if (!value || (value === person.ign && links(changeIgn(mogi, person.id, value)) === links(mogi))) {
      setIgn(person.ign);
      return;
    }
    setError("");
    if (await onIgnChange(person, value)) setIgn(value);
    else {
      setIgn(person.ign);
      setError("Couldn't save the in-game name. Try again.");
    }
  }
  return (
    <>
      <ListGroup title="In-game name" note="The name recognition looks for in the screenshots.">
        <Input
          variant="filled"
          aria-label="In-game name"
          value={ign}
          maxLength={80}
          disabled={busy}
          onChange={(event) => setIgn(event.target.value)}
          onBlur={() => void saveIgn()}
        />
      </ListGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <List>
        {team && (
          <ListRow
            accessory="chevron"
            onSelect={() => onTeam(team.teamId)}
            trail={
              <span className="flex items-center gap-2">
                <TeamMark mogi={mogi} id={team.teamId} />
                {!team.tag && teamLabel(mogi, team.teamId)}
              </span>
            }
          >
            Team
          </ListRow>
        )}
        {count > 0 && standing && (
          <ListRow trail={`${standing.rank === null ? "—" : ordinal(standing.rank)} · ${standing.points ?? "—"} pts`}>
            In this mogi
          </ListRow>
        )}
        {synonyms.map((synonym) => (
          <NameReading
            key={synonym}
            reading={synonym}
            suggested={!!suggested(synonym)}
            busy={busy}
            onUnlink={() => void unlink(synonym)}
          />
        ))}
        {substitutions.length
          ? substitutions.map((entry) => {
              const outgoing = entry.outgoingParticipantId === person.id;
              const other = mogi.participants.find(
                (person) => person.id === (outgoing ? entry.incomingParticipantId : entry.outgoingParticipantId),
              );
              return (
                <ListRow key={entry.id} description={`From ${substitutionEntryLabel(mogi, entry)}`}>
                  {outgoing ? `Subbed out for ${other?.loungeName}` : `Subbing for ${other?.loungeName}`}
                </ListRow>
              );
            })
          : count < 12 && (
              <ListRow accessory="chevron" onSelect={onSub}>
                Record Sub
              </ListRow>
            )}
        {credited && (
          <ListRow
            trail={credited.loungeName}
            accessory="chevron"
            disabled={busy}
            onSelect={() => {
              setError("");
              void onCredit(slot).then((saved) => {
                if (!saved) setError("Couldn't reopen the credit question. Try again.");
              });
            }}
          >
            Credit
          </ListRow>
        )}
      </List>
    </>
  );
}

/** Team: fixed members (bot list); only the displayed tag can change, and a chosen tag always wins. */
function TeamPage({
  mogi,
  team,
  members,
  busy,
  onUpdate,
  onOpen,
}: {
  mogi: Mogi;
  team: TeamTag;
  members: Participant[];
  busy: boolean;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onOpen: (id: string) => void;
}) {
  const [tag, setTag] = useState(team.tag ?? "");
  const [error, setError] = useState("");
  // Saves on leaving the field, like the in-game name; `undefined` returns the team to the inferred tag.
  async function save(value: string | undefined) {
    if (value !== undefined && value === (team.tag ?? "")) {
      setTag(value);
      return;
    }
    setError("");
    const teams = mogi.teams?.map((entry) => {
      if (entry.id !== team.teamId) return entry;
      const next = { ...entry, tag: value };
      if (value === undefined) delete next.tag;
      return next;
    });
    const updated = { ...mogi, teams };
    if (await onUpdate(updated))
      setTag(inferTeamTags(updated).find((entry) => entry.teamId === team.teamId)?.tag ?? "");
    else {
      setTag(team.tag ?? "");
      setError("Couldn't save the tag. Try again.");
    }
  }
  const note = team.chosen
    ? team.inferred
      ? `The in-game names suggest ${team.inferred}.`
      : "The in-game names don't suggest a tag."
    : team.tag
      ? "Read from the in-game names. Change it if it's wrong."
      : team.inferred
        ? `Another team also seems to use ${team.inferred}. Pick a tag for this one, or leave it empty.`
        : "The in-game names don't suggest a tag. Without one, the team shows its number.";
  return (
    <>
      <ListGroup title="Tag" note={note}>
        <Input
          variant="filled"
          aria-label="Tag"
          placeholder="No tag"
          value={tag}
          maxLength={5}
          disabled={busy}
          onChange={(event) => setTag(event.target.value)}
          onBlur={() => void save(tag.trim())}
        />
        {team.chosen && team.inferred && team.tag !== team.inferred && (
          <Button
            variant="link"
            className="mt-2"
            disabled={busy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void save(undefined)}
          >
            Use {team.inferred}
          </Button>
        )}
      </ListGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ListGroup title="Members">
        <List aria-label="Members">
          {members.map((person) => (
            <ListRow
              key={person.id}
              accessory="chevron"
              buttonProps={{ "aria-label": person.loungeName }}
              onSelect={() => onOpen(person.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">{person.loungeName}</span>
                <span className="truncate text-sm text-muted-foreground">{person.ign}</span>
              </span>
            </ListRow>
          ))}
        </List>
      </ListGroup>
    </>
  );
}

function SubstitutionForm({
  mogi,
  person,
  busy,
  onUpdate,
  onSaved,
}: {
  mogi: Mogi;
  person: Participant;
  busy: boolean;
  onUpdate: (mogi: Mogi) => Promise<boolean>;
  onSaved: (name: string, from: number) => void;
}) {
  const count = resultCoverage(mogi).included.length;
  const [name, setName] = useState("");
  const [from, setFrom] = useState(String(Math.min(count + 1, 12)));
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setError("");
    try {
      const updated = registerSubstitution(mogi, {
        slotId: participationSlot(person),
        loungeName: name,
        ign: "",
        fromRace: Number(from),
      });
      if (await onUpdate(updated)) {
        onSaved(name.trim(), Number(from));
        return;
      }
      setError("Couldn't save the sub. Your data was preserved. Try again.");
    } catch {
      // Validation stays in the engine; the sheet doesn't expose the engine's internal messages.
      setError("Couldn't record this sub. Check the Lounge name and starting race.");
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="section-stack">
      <ListGroup title="Who comes in" note="As shown on the Lounge.">
        <Input
          variant="filled"
          aria-label="Sub's Lounge name"
          placeholder="Sub's Lounge name"
          value={name}
          maxLength={80}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
      </ListGroup>
      <ListGroup
        title="Starting from race"
        note={
          from === "1"
            ? `${person.loungeName} never raced: every race goes to the sub.`
            : `Races before ${from} stay with ${person.loungeName}.`
        }
      >
        <ChoiceGrid
          aria-label="Starting from race"
          value={from}
          onValueChange={setFrom}
          options={Array.from({ length: 12 }, (_, index) => ({
            value: String(index + 1),
            label: index + 1,
            disabled: busy || index + 1 > count + 1,
          }))}
        />
      </ListGroup>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
        Record Sub
      </Button>
    </form>
  );
}
