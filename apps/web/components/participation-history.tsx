import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import type { Mogi, Race } from "@/lib/mogi/types";

export function ParticipationHistory({ mogi, race }: { mogi: Mogi; race: Race }) {
  const name = (id: string) => mogi.participants.find((person) => person.id === id)?.loungeName ?? "Unknown player";
  if (!race.participationReview && !race.participationHistory?.length) return null;
  return (
    <Card>
      <CardContent>
        {race.participationReview && (
          <Alert>
            <AlertDescription>
              <p>{race.participationReview}</p>
              <p>Kept · {race.placements.map(name).join(", ")}</p>
            </AlertDescription>
          </Alert>
        )}
        {!!race.participationHistory?.length && (
          <Disclosure title="Earlier Participation">
            <ol className="space-y-4">
              {race.participationHistory.map((snapshot, index) => (
                <Item asChild variant="outline" key={`${snapshot.changedAt}-${index}`}>
                  <li>
                    <ItemContent>
                      <ItemTitle wrap>
                        Race {snapshot.result.number ?? "?"} · {snapshot.reason}
                      </ItemTitle>
                      <ItemDescription wrap>
                        Placements · {snapshot.result.placements.map(name).join(", ")}
                      </ItemDescription>
                      {!!snapshot.result.absentParticipantIds?.length && (
                        <ItemDescription wrap>
                          Absent · {snapshot.result.absentParticipantIds.map(name).join(", ")}
                        </ItemDescription>
                      )}
                      <ul className="space-y-1">
                        {Object.entries(snapshot.result.nativePoints ?? {}).map(([id, points]) => (
                          <Item asChild variant="muted" key={id}>
                            <li>
                              <ItemContent>
                                <ItemDescription wrap>
                                  {name(id)} · {points} in-game points ·{" "}
                                  {snapshot.result.nativePointOrigins?.[id] ?? "earlier screenshot"}
                                </ItemDescription>
                              </ItemContent>
                            </li>
                          </Item>
                        ))}
                      </ul>
                    </ItemContent>
                  </li>
                </Item>
              ))}
            </ol>
          </Disclosure>
        )}
      </CardContent>
    </Card>
  );
}
