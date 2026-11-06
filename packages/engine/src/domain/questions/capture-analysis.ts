import type { Mogi } from "../types.ts";
import { contextQuestions } from "./questions.ts";

/** Project the application's accepted sequence and its current clarification questions. */
export function analyzeCaptures(mogi: Mogi) {
  return {
    sequence: mogi.sequence ? { accepted: mogi.sequence } : undefined,
    questions: contextQuestions(mogi),
  };
}
