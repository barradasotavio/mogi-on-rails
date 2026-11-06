import type { Mogi, Race } from "../types.ts";

/** English catalog and the abbreviations of the MKW Lounge track emojis. */
export const tracks = [
  { short: "MBC", name: "Mario Bros. Circuit" },
  { short: "CC", name: "Crown City" },
  { short: "WS", name: "Whistlestop Summit" },
  { short: "DKS", name: "DK Spaceport" },
  { short: "rDH", name: "Desert Hills" },
  { short: "rSGB", name: "Shy Guy Bazaar" },
  { short: "rWS", name: "Wario Stadium" },
  { short: "rAF", name: "Airship Fortress" },
  { short: "rDKP", name: "DK Pass" },
  { short: "SP", name: "Starview Peak" },
  { short: "rSHS", name: "Sky-High Sundae" },
  { short: "rWSh", name: "Wario Shipyard" },
  { short: "rKTB", name: "Koopa Troopa Beach" },
  { short: "FO", name: "Faraway Oasis" },
  { short: "rPB", name: "Peach Beach" },
  { short: "SSS", name: "Salty Salty Speedway" },
  { short: "rDDJ", name: "Dino Dino Jungle" },
  { short: "GBR", name: "Great ? Block Ruins" },
  { short: "CCF", name: "Cheep Cheep Falls" },
  { short: "DD", name: "Dandelion Depths" },
  { short: "BCi", name: "Boo Cinema" },
  { short: "DBB", name: "Dry Bones Burnout" },
  { short: "rMMM", name: "Moo Moo Meadows" },
  { short: "rCM", name: "Choco Mountain" },
  { short: "rTF", name: "Toad's Factory" },
  { short: "BC", name: "Bowser's Castle" },
  { short: "AH", name: "Acorn Heights" },
  { short: "rMC", name: "Mario Circuit" },
  { short: "PS", name: "Peach Stadium" },
  { short: "RR", name: "Rainbow Road" },
  { short: "rMC1", name: "SNES Mario Circuit 1" },
  { short: "rMC2", name: "SNES Mario Circuit 2" },
  { short: "rMC3", name: "SNES Mario Circuit 3" },
  { short: "rGV1", name: "SNES Ghost Valley 1" },
  { short: "rGV2", name: "SNES Ghost Valley 2" },
  { short: "rGV3", name: "SNES Ghost Valley 3" },
  { short: "rCI1", name: "SNES Choco Island 1" },
  { short: "rCI2", name: "SNES Choco Island 2" },
  { short: "rKB1", name: "SNES Koopa Beach 1" },
  { short: "rVL1", name: "SNES Vanilla Lake 1" },
] as const;

export type Track = (typeof tracks)[number];

/** Brazilian (and differing European) in-game names, only for reading the pre-race label. SNES courses match with or without the prefix. */
const portugueseNames: Record<Track["short"], readonly string[]> = {
  MBC: ["Circuito Mario Bros."],
  CC: ["Metrópole Coroada"], // english-check: data
  WS: ["Pico Locomotiva"],
  DKS: ["Centro Espacial DK"],
  rDH: ["Colinas Desérticas"], // english-check: data
  rSGB: ["Bazar Shy Guy", "Bazar do Masquito"],
  rWS: ["Estádio Wario"], // english-check: data
  rAF: ["Fortaleza Voadora"],
  rDKP: ["Passagem DK"],
  SP: ["Pico Boreal"],
  rSHS: ["Céus Gelados"], // english-check: data
  rWSh: ["Naufrágio Wario", "Galeão do Wario"], // english-check: data
  rKTB: ["Praia Koopa Troopa"],
  FO: ["Savana Selvagem"],
  rPB: ["Praia Peach"],
  SSS: ["Canais Salgados"],
  rDDJ: ["Selva Dino Dino"],
  GBR: ["Ruínas Bloco ?"], // english-check: data
  CCF: ["Cataratas Cheep Cheep"],
  DD: ["Gruta Dente-de-Leão"], // english-check: data
  BCi: ["Cinema Bu"],
  DBB: ["Vulcão Quebra-ossos"], // english-check: data
  rMMM: ["Prado Mu Mu"],
  rCM: ["Monte Achocolatado"],
  rTF: ["Fábrica do Toad"], // english-check: data
  BC: ["Castelo do Bowser"],
  AH: ["Bosque das Bolotas"],
  rMC: ["Circuito Mario", "Circuito do Mario"],
  PS: ["Estádio Peach"], // english-check: data
  RR: ["Estrada Arco-Íris"], // english-check: data
  rMC1: ["Circuito Mario 1"],
  rMC2: ["Circuito Mario 2"],
  rMC3: ["Circuito Mario 3"],
  rGV1: ["Vale Fantasma 1"],
  rGV2: ["Vale Fantasma 2"],
  rGV3: ["Vale Fantasma 3"],
  rCI1: ["Ilha Chocolate 1"],
  rCI2: ["Ilha Chocolate 2"],
  rKB1: ["Praia Koopa Troopa 1", "Praia Koopa 1"],
  rVL1: ["Lago Baunilha 1"],
};

function normalized(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Every spelling that names the track as a whole: English, code, Portuguese, and SNES-prefixed Portuguese. */
function trackKeys(track: Track): string[] {
  const portuguese = portugueseNames[track.short];
  const prefixed = track.name.startsWith("SNES ") ? portuguese.map((name) => `SNES ${name}`) : [];
  return [track.name, track.short, ...portuguese, ...prefixed].map(normalized);
}

const strayFragmentLength = 2; // OCR picks up a letter or two of map art beside the banner, never a word.

/**
 * A known name followed only by short letter fragments ("Canais Salgados C"). Digits never count as
 * noise, so a numbered name never matches its unnumbered sibling.
 */
export function nameWithStrayFragments(text: string, track: Track): boolean {
  const words = text.split(/\s+/).filter((word) => normalized(word));
  return words.some((_, end) => {
    if (end === 0) return false;
    const rest = words.slice(end).map(normalized);
    return (
      trackKeys(track).includes(normalized(words.slice(0, end).join(" "))) &&
      rest.every((word) => word.length <= strayFragmentLength && !/[0-9]/.test(word))
    );
  });
}

/** Accepts English and official Portuguese names or codes as a whole match, else one name followed by stray fragments. */
export function matchTrack(text: string): Track | null {
  const key = normalized(text);
  if (!key) return null;
  const whole = tracks.filter((track) => trackKeys(track).includes(key));
  if (whole.length) return whole.length === 1 ? whole[0] : null;
  const trailing = tracks.filter((track) => nameWithStrayFragments(text, track));
  return trailing.length === 1 ? trailing[0] : null;
}

/** The choice belongs to the race; readings count only in the pre-race contexts linked to it. */
export function raceTrack(mogi: Mogi, race: Race): (Track & { source: "manual" | "capture" }) | null {
  const chosen = tracks.find((track) => track.short === race.track);
  if (chosen) return { ...chosen, source: "manual" };
  const matched = (mogi.captures ?? [])
    .filter(
      (capture) =>
        capture.context?.phase === "before" &&
        (capture.context.raceId === race.id || race.captureIds?.includes(capture.id)),
    )
    .map((capture) => matchTrack(capture.interpretation?.nextTrack?.text ?? ""))
    .filter((track) => track !== null);
  const unique = new Map(matched.map((track) => [track.short, track]));
  return unique.size === 1 ? { ...unique.values().next().value!, source: "capture" } : null;
}
