"use client";
import { type FactInput, participantsForOccurrence } from "@mkw/engine";
import { useId, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { raceLabel } from "@/lib/mogi/race-label";
import type { Mogi } from "@/lib/mogi/types";

function KnownPosition({
  mogi,
  busy,
  onFact,
}: {
  mogi: Mogi;
  busy: boolean;
  onFact: (fact: FactInput) => Promise<boolean>;
}) {
  const id = useId();
  const races = mogi.races.filter((race) => mogi.assistance?.analysis?.targetRaceIds.includes(race.id));
  const [raceId, setRaceId] = useState("");
  const race = races.find((race) => race.id === raceId) ?? races[0];
  const people = race ? participantsForOccurrence(mogi, race) : [];
  const [participantId, setParticipantId] = useState("");
  const person = people.find((person) => person.id === participantId) ?? people[0];
  const [position, setPosition] = useState("unknown");
  if (!race || !person) return null;
  return (
    <Disclosure title="Edit Known Positions">
      <Field>
        <FieldLabel htmlFor={`${id}-race`}>Race</FieldLabel>
        <NativeSelect
          id={`${id}-race`}
          value={race.id}
          disabled={busy}
          onChange={(event) => setRaceId(event.target.value)}
        >
          {races.map((race) => (
            <option key={race.id} value={race.id}>
              {raceLabel(mogi, race)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-person`}>Player</FieldLabel>
        <NativeSelect
          id={`${id}-person`}
          value={person.id}
          disabled={busy}
          onChange={(event) => setParticipantId(event.target.value)}
        >
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.loungeName}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-position`}>Known position</FieldLabel>
        <NativeSelect
          id={`${id}-position`}
          value={position}
          disabled={busy}
          onChange={(event) => setPosition(event.target.value)}
        >
          <option value="unknown">Choose a position</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i + 1}>
              {i + 1}
            </option>
          ))}
          <option value="absent">Absent</option>
        </NativeSelect>
      </Field>
      <Button
        variant="secondary"
        className="w-full"
        disabled={busy || position === "unknown"}
        onClick={() =>
          void onFact({
            raceId: race.id,
            participantId: person.id,
            position: position === "absent" ? "absent" : Number(position),
          })
        }
      >
        Save Known Position
      </Button>
    </Disclosure>
  );
}

export function PositionQuestions({
  mogi,
  busy,
  onFact,
}: {
  mogi: Mogi;
  busy: boolean;
  onFact: (fact: FactInput) => Promise<boolean>;
}) {
  const analysis = mogi.assistance?.analysis;
  if (!analysis) return null;
  const name = (id: string) => mogi.participants.find((person) => person.id === id)?.loungeName ?? id;
  return (
    <section aria-label="Positions to clarify">
      <Card>
        <CardContent>
          <div className="min-w-0 space-y-3 break-words">
            <Alert role="status" variant={analysis.status === "conflict" ? "destructive" : "default"}>
              <AlertDescription>{analysis.message}</AlertDescription>
            </Alert>
            {!analysis.complete && <p>The search is incomplete; the examples do not prove a unique result.</p>}
            {mogi.assistance?.facts.map((fact) => (
              <div key={fact.id} className="space-y-2">
                <p>
                  {name(fact.participantId)} ·{" "}
                  {raceLabel(
                    mogi,
                    mogi.races.find((race) => race.id === fact.raceId)!,
                  )}
                  : {fact.position === "absent" ? "absent" : fact.position} · entered by you
                </p>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove position: ${name(fact.participantId)}`}
                  onClick={() =>
                    void onFact({
                      id: fact.id,
                      raceId: fact.raceId,
                      participantId: fact.participantId,
                      position: "unknown",
                    })
                  }
                >
                  Remove Position
                </Button>
              </div>
            ))}
            <KnownPosition mogi={mogi} busy={busy} onFact={onFact} />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
