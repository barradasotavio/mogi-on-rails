import { mogiOverview } from "@mkw/engine";

import type { Mogi } from "./types.ts";

/** Release only original bytes. All evidence and answers remain part of the mogi. */
export function deleteMogiImages(mogi: Mogi): Mogi {
  if (!mogiOverview(mogi).finished) throw new Error("Only a finished mogi can have its screenshots deleted.");
  return { ...mogi, captures: mogi.captures?.map((capture) => ({ ...capture, original: null })) };
}
