import { participationSlot } from "@mkw/engine";

import type { Mogi } from "@/lib/mogi/types";

/** Validate ZIP3 coverage before normalization; a derived ledger is never input evidence. */
export function validateCoverage(value: unknown, mogi: Mogi, sourceIds: Set<string>) {
  const fail = (): never => {
    throw new Error("Proven total: invalid data or references.");
  };
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : fail();
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : fail());
  const text = (value: unknown): string =>
    typeof value === "string" && value.trim().length > 0 && value.length <= 1000000 ? value : fail();
  const integer = (value: unknown, min = 0, max = 180): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
  const unique = (values: unknown[]): string[] => {
    const ids = values.map(text);
    return new Set(ids).size === ids.length ? ids : fail();
  };
  const people = new Set(mogi.participants.map((person) => person.id));
  const slots = new Set(
    mogi.participants.filter((person) => participationSlot(person) === person.id).map((person) => person.id),
  );
  const liveSources = new Set(mogi.captures?.map((capture) => capture.id) ?? []);
  const occurrences = new Set(mogi.sequence?.occurrences.map((entry) => entry.id) ?? []);
  const contribution = (value: unknown, historical = false) => {
    const entry = object(value);
    text(entry.id);
    text(entry.signature);
    if (entry.adjustment !== "native-12") fail();
    const sources = unique(list(entry.sourceCaptureIds));
    if (
      sources.length < 1 ||
      sources.length > 2 ||
      sources.some((id) => !(historical ? sourceIds : liveSources).has(id))
    )
      fail();
    const from = text(entry.fromOccurrenceId),
      to = text(entry.toOccurrenceId);
    if (
      !historical &&
      (!occurrences.has(to) || (!occurrences.has(from) && !(sources.length === 1 && from === `zero:${sources[0]}`)))
    )
      fail();
    const numbers = list(entry.validRaceNumbers).map((number) => integer(number, 1, 12));
    if (!numbers.length || numbers.some((number, index) => index > 0 && number !== numbers[index - 1] + 1)) fail();
    const discarded = entry.discardedRaceIds === undefined ? [] : unique(list(entry.discardedRaceIds));
    if (discarded.some((id) => !mogi.races.some((race) => race.id === id))) fail();
    const steps =
      entry.physicalSteps === undefined ? numbers.length : integer(entry.physicalSteps, numbers.length, 999);
    if (steps !== numbers.length + discarded.length) fail();
    const values = list(entry.values),
      persons = new Set<string>(),
      participations = new Set<string>();
    let total = 0,
      rawTotal = 0;
    for (const value of values) {
      const row = object(value),
        person = text(row.participantId),
        slot = text(row.slotId);
      if (
        !people.has(person) ||
        !slots.has(slot) ||
        persons.has(person) ||
        participations.has(slot) ||
        participationSlot(mogi.participants.find((entry) => entry.id === person)!) !== slot
      )
        fail();
      persons.add(person);
      participations.add(slot);
      const raw = integer(row.raw, steps, steps * 15),
        adjusted = integer(row.adjusted, numbers.length, numbers.length * 15);
      if ((!discarded.length && raw !== adjusted) || adjusted > raw) fail();
      total += adjusted;
      rawTotal += raw;
    }
    if (values.length !== 12 || total !== 82 * numbers.length || rawTotal !== 82 * steps) fail();
  };
  const coverage = object(value);
  if (coverage.version !== 1) fail();
  const intervals = list(coverage.intervals);
  unique(intervals.map((value) => object(value).id));
  intervals.forEach((value) => contribution(value));
  list(coverage.history).forEach((value) => {
    const entry = object(value);
    text(entry.reason);
    contribution(entry.contribution, true);
  });
}
