/** Facts implied by the game screen, independent of its observed numbers. */
const before = {
  moment: "before",
  order: "none",
  cumulative: "final",
  offset: 1,
  gameTeamGroups: false,
  teamTotals: false,
} as const;
const after = {
  moment: "after",
  order: "finishOrder",
  cumulative: "final",
  offset: 0,
  gameTeamGroups: false,
  teamTotals: false,
} as const;
export const screens = {
  twoColumns: { ...before, name: "Two columns" },
  twoColumnsByTeam: { ...before, name: "Two columns, by team", order: "grouped", gameTeamGroups: true },
  finishOrderAdding: { ...after, name: "Finish order, adding points", cumulative: "unsettled" },
  finishOrderAdded: { ...after, name: "Finish order, points added" },
  overallStandings: { ...after, name: "Overall standings", order: "general" },
  teamStandings: { ...after, name: "Team standings", order: "grouped", gameTeamGroups: true, teamTotals: true },
  finalStandings: { ...after, name: "Final standings", moment: "event-final", order: "general" },
  unknown: {
    name: "Not recognized",
    moment: undefined,
    order: "unknown",
    cumulative: "unknown",
    offset: 0,
    gameTeamGroups: false,
    teamTotals: false,
  },
} as const;
export type Screen = keyof typeof screens;
export type ScreenMoment = "before" | "after" | "event-final";
export function isScreen(value: unknown): value is Screen {
  return typeof value === "string" && Object.hasOwn(screens, value);
}
export function screenProperties(screen: Screen): (typeof screens)[Screen];
export function screenProperties(screen: Screen | undefined): (typeof screens)[Screen] | undefined;
export function screenProperties(screen: Screen | undefined) {
  return screen === undefined ? undefined : screens[screen];
}
export const momentLabels = {
  before: "Before the race",
  after: "After the race",
  "event-final": "End of the event",
} as const;
/** Context and sequence facts also carry moments without an image. */
export function momentOffset(moment: ScreenMoment): 0 | 1 {
  return moment === "before" ? 1 : 0;
}

/** Structural screen contract for restored captures. */
export function hasScreenInterpretation(value: Record<string, unknown>, observedRows: number): boolean {
  if (!isScreen(value.screen) || ["layout", "order", "cumulative"].some((key) => Object.hasOwn(value, key)))
    return false;
  const properties = screens[value.screen];
  return (
    Array.isArray(value.positions) &&
    value.positions.length === (properties.gameTeamGroups || properties.moment === "before" ? 0 : observedRows) &&
    (value.nextTrack === undefined || properties.moment === "before") &&
    (properties.moment !== "before" ||
      (Array.isArray(value.movementRows) && value.movementRows.length === 0 && value.currentScale === undefined))
  );
}
