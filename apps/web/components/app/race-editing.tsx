"use client";

import { participantsForOccurrence, prepareRaceForReview } from "@mkw/engine";

import { NameReview } from "@/components/captures/name-review";
import { ParticipationHistory } from "@/components/participation-history";
import { RaceEditor } from "@/components/race-editor";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { raceLabel } from "@/lib/mogi/race-label";
import type { Mogi } from "@/lib/mogi/types";

import type { MogiSessionHandle } from "./use-mogi-session";

/**
 * The open race editor of the mogi: the name review of one screenshot (a result or a context screen),
 * or Edit Result. Its drafts save silently while it is open.
 */
export function RaceEditing({
  mogi,
  session,
  busy,
  draftError,
}: {
  mogi: Mogi;
  session: MogiSessionHandle;
  busy: boolean;
  /** A failed write shows under Edit Result's draft. */
  draftError: boolean;
}) {
  const { editor } = session;
  const editingRace = editor.race;
  const editorRace = editor.editorRace;
  const editingNameCapture = editor.nameCapture;
  const contextTarget = editor.contextTarget;
  if (!editingRace || !editorRace) return null;
  return (
    <div className="space-y-5" role="region" aria-label={editingNameCapture ? "Screenshot review" : "Race edit"}>
      {editingNameCapture ? (
        <NameReview
          key={`${editingRace.id}:${editingNameCapture.id}:${editingNameCapture.context ? "context" : "result"}`}
          preserveResult={editorRace.origin === "manual" && !editingNameCapture.context}
          mogi={{
            ...mogi,
            participants:
              editingNameCapture.context && !contextTarget
                ? mogi.participants
                : participantsForOccurrence(mogi, mogi.races.find((race) => race.id === contextTarget) ?? editingRace),
          }}
          race={editorRace}
          capture={editingNameCapture}
          initialFields={
            editingNameCapture.contextDraft ??
            (mogi.raceDraft?.raceId === editingRace.id ? mogi.raceDraft.fields : undefined)
          }
          busy={busy}
          disabled={false}
          context={
            <>
              <ParticipationHistory mogi={mogi} race={editingRace} />
              {editingNameCapture.context && (
                <>
                  <p className="text-sm">
                    {contextTarget
                      ? mogi.sequence?.associations?.some(
                          (entry) => entry.captureId === editingNameCapture.id && entry.raceId === contextTarget,
                        )
                        ? "Inferred association; checked again when the screenshot changes"
                        : "Explicit association with an existing race"
                      : "Race not yet associated"}
                  </p>
                  <Field>
                    <FieldLabel htmlFor="context-race">Race for this screenshot</FieldLabel>
                    <NativeSelect
                      id="context-race"
                      disabled={busy}
                      value={contextTarget}
                      onChange={(event) => editor.setContextTarget(event.target.value)}
                    >
                      <option value="">No association</option>
                      {mogi.races.map((race) => (
                        <option key={race.id} value={race.id}>
                          {raceLabel(mogi, race)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              )}
            </>
          }
          onChange={(fields) =>
            editor.writeDraft(() =>
              editingNameCapture.context
                ? session.saveContextDraft(editingNameCapture, fields)
                : session.saveNameDraft(editorRace, editingNameCapture, fields),
            )
          }
          onSaveContext={async (fields) => {
            if (await session.saveContext(editingNameCapture, fields, contextTarget || undefined)) {
              editor.closeRace();
            }
          }}
          onSave={(race, nameAssociations, numericAnswers, editedResult) =>
            session.saveRace(
              race,
              {
                ...editingNameCapture,
                nameAssociations,
                numericAnswers,
                reviewedPlacements: race.placements,
                reviewedAt: new Date().toISOString(),
              },
              undefined,
              undefined,
              !editedResult,
            )
          }
          onCancel={() => {
            editor.closeRace();
          }}
        />
      ) : (
        <RaceEditor
          key={editingRace.id}
          mogi={{
            ...mogi,
            participants: participantsForOccurrence(mogi, editingRace),
          }}
          race={prepareRaceForReview(mogi, editorRace)}
          initialFields={mogi.raceDraft?.raceId === editingRace.id ? mogi.raceDraft.fields : undefined}
          onDraftChange={(fields) => void editor.writeDraft(() => session.saveRaceDraft(editingRace, fields))}
          draftError={draftError}
          reviewContext={<ParticipationHistory mogi={mogi} race={editingRace} />}
          onSave={session.saveRace}
          busy={busy && editor.draftWrites === 0}
        />
      )}
    </div>
  );
}
