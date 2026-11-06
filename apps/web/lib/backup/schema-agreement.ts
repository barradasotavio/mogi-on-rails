import type { TrackerState } from "@/lib/mogi/types";

import type { TrackerRecord } from "./schema.ts";

/**
 * Compile-time check that the persisted types in `lib/mogi/types.ts` and the backup schemas agree:
 * every state the app can write is, by type, a state restore accepts. A field the app adds,
 * widens or makes optional without the schema fails `npm run typecheck` here.
 */

/** A schema's declared fields, without the index signature a loose object adds; maps of values stay. */
type Declared<T> = T extends Blob
  ? T
  : T extends readonly (infer Item)[]
    ? Declared<Item>[]
    : T extends object
      ? { [K in keyof T as string extends K ? (unknown extends T[K] ? never : K) : K]: Declared<T[K]> }
      : T;

type Fits<A extends B, B> = A;
export type StateFitsSchema = Fits<TrackerState, Declared<TrackerRecord>>;
