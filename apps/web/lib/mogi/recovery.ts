export type RecoveryTarget = "players" | "images" | "race" | "settings" | "questions" | "draft";
export interface ActionRecovery {
  message: string;
  label: string;
  target: RecoveryTarget;
}
export interface ReviewContext {
  mogiId: string;
  captureId?: string;
  raceId?: string;
}

// Each notice keeps an explicit destination; guidance never becomes text without an action.
// Keys match thrown messages exactly: rewording a message rewords its key (recovery.test.ts checks each is thrown).
export const staleActionDestinations: Record<string, RecoveryTarget> = {
  "The data changed. Reopen this action before making corrections.": "settings",
  "The IGN changed. Reopen the editor to continue.": "players",
  "The screenshots changed. Resume the current batch.": "images",
  "The review changed. Reopen the batch to continue.": "images",
  "This review's screenshot changed or was already accepted. Reopen it.": "images",
  "The screenshot reading changed. Resume the analysis before accepting.": "images",
  "The race or participation changed. Reopen the name review.": "race",
  "This screenshot's review changed or was already accepted. Reopen the screenshot.": "images",
  "This screenshot's file changed. Resume the current review.": "images",
  "This screenshot's race changed. Resume the current review.": "images",
  "This screenshot's answers changed. Resume the current review.": "images",
  "This screenshot or its answers changed. Reopen the screenshot.": "images",
  "The screenshot changed. Reopen it before making corrections.": "images",
  "The race changed. Go back and reopen the editor to check the current data.": "race",
  "The screenshot changed. Reopen the race.": "race",
  "The screenshot changed. Reopen the review to continue with the current answers.": "images",
  "This screenshot's result changed. Reopen the review to continue.": "images",
  "The race changed. Reopen the name review.": "race",
  "The screenshot changed. Open the questions again.": "images",
  "The screenshot changed. Reopen it.": "images",
  "The screenshot changed. Resume the current review.": "images",
  "The screenshot was replaced. Resume the current one.": "images",
  "This screenshot changed. Reopen it.": "images",
  "The screenshots or answers changed. Check the current sequence before answering.": "questions",
  "This relation changed. Check the current screenshots.": "questions",
  "This interval changed. Check the current screenshots.": "questions",
  "The participation changed. Discard the draft to review the race with the current players.": "draft",
  "The race changed. Discard the draft to check the current data.": "draft",
};

const labels: Record<RecoveryTarget, string> = {
  settings: "Review Mogi",
  players: "Review Players",
  images: "Review Screenshots",
  race: "Review Race",
  questions: "Review Questions",
  draft: "Discard Draft",
};

export function staleActionRecovery(message: string): ActionRecovery | undefined {
  const target = staleActionDestinations[message];
  return target ? { message: message.slice(0, message.indexOf(".") + 1), label: labels[target], target } : undefined;
}
