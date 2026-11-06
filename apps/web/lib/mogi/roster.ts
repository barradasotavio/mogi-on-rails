import type { Mogi, MogiFormat } from "./types";

export const formats: MogiFormat[] = ["FFA", "2v2", "3v3"];
export function playersPerTeam(format: MogiFormat): number {
  return format === "FFA" ? 1 : Number(format[0]);
}

/** Read the full bot list without mistaking room metadata or MMR for names. */
export function readLoungeRoster(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim().replace(/^\*\*|\*\*$/g, ""));
  const tiers = lines.flatMap((line) => [...line.matchAll(/\bTier\s+([\w-]+)/gi)].map((match) => match[1]));
  const numbered = lines.filter((line) => /^\d+[.)]/.test(line));
  const groups = numbered.map((line) => {
    const match = /^(\d+)[.)]\s+(.+?)\s*(?:\([\d,.-]+\s*MMR\))?$/i.exec(line);
    return { number: Number(match?.[1]), names: match?.[2].split(",").map((name) => name.trim()) ?? [] };
  });
  const names = groups.flatMap((group) => group.names);
  const size = groups[0]?.names.length ?? 0;
  if (size === 4 || size === 6) {
    throw new Error("This app supports FFA, 2v2 and 3v3. 4v4 and 6v6 lists can't be used.");
  }
  if (
    tiers.length !== 1 ||
    !groups.length ||
    groups.some((group, index) => group.number !== index + 1 || group.names.length !== size) ||
    names.length !== 12 ||
    names.some((name) => !name || name.length > 80) ||
    new Set(names.map((name) => name.normalize("NFKC").toLocaleLowerCase())).size !== 12 ||
    ![1, 2, 3].includes(size)
  ) {
    throw new Error("Paste the full Lounge bot list, with the tier and 12 different players in equal, numbered teams.");
  }
  const format: MogiFormat = size === 1 ? "FFA" : (`${size}v${size}` as MogiFormat);
  return { format, tier: tiers[0], names };
}

/** A new mogi from the bot list it was read from; tests pass ids and a date to stay deterministic. */
export function newMogi(
  rosterText: string,
  { format, tier, names }: ReturnType<typeof readLoungeRoster>,
  {
    id = crypto.randomUUID(),
    participantId = (): string => crypto.randomUUID(),
    createdAt = new Date(),
  }: { id?: string; participantId?: (index: number) => string; createdAt?: Date } = {},
): Mogi {
  const teamSize = playersPerTeam(format);
  const teamCount = format === "FFA" ? 0 : 12 / teamSize;
  return {
    id,
    name: `Mogi ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(createdAt)}`,
    format,
    submissionTier: tier,
    originalList: rosterText,
    teams: Array.from({ length: teamCount }, (_, n) => ({ id: `team-${n + 1}`, name: `Team ${n + 1}` })),
    createdAt: createdAt.toISOString(),
    races: [],
    participants: names.map((loungeName, n) => ({
      id: participantId(n),
      teamId: format === "FFA" ? undefined : `team-${Math.floor(n / teamSize) + 1}`,
      loungeName,
      ign: loungeName,
      ignOrigin: "fallback",
    })),
  };
}
