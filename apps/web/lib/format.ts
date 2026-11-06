/** Human-readable presentation only; persisted timestamps remain ISO strings. */
export function humanDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.valueOf())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

/** English ordinal for a placement: 1st, 2nd, 3rd, 11th. */
export function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th");
  return `${rank}${suffix}`;
}

// Articles, coordinating conjunctions and prepositions of four letters or fewer stay lowercase inside a title.
export const minorWords = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "so",
  "yet",
  "as",
  "at",
  "by",
  "in",
  "into",
  "of",
  "off",
  "on",
  "onto",
  "out",
  "over",
  "per",
  "to",
  "up",
  "upon",
  "via",
  "with",
  "from",
]);

/** Title Case as in Apple's style: "The race changed" → "The Race Changed". Proper nouns and literals keep their case. */
export function titleCase(text: string): string {
  const words = text.split(" ");
  return words
    .map((word, index) =>
      index > 0 && index < words.length - 1 && minorWords.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.replace(/^[a-z]/, (letter) => letter.toUpperCase()),
    )
    .join(" ");
}
