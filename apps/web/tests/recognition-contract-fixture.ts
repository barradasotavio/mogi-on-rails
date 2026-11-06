import { type RawRecognition, recognizeImage } from "@mkw/engine/browser";

declare global {
  interface Window {
    teamStandingsRecognition: Promise<RawRecognition>;
    zeroPreRaceRecognition: Promise<RawRecognition>;
  }
}

export function readTeamStandings() {
  window.teamStandingsRecognition = (async () => {
    const original = new URL("./fixtures/spec29-teams/teams-board.jpeg", import.meta.url);
    const response = await fetch(original);
    if (!response.ok) throw new Error(`Cannot load team standings capture: ${response.status}`);
    return recognizeImage(await response.blob(), () => {}).result;
  })();
}

/** The race 1 pre-race board: the grouped board with Xpokey's lone 0 copied over every other card total. */
export function readZeroPreRace() {
  window.zeroPreRaceRecognition = (async () => {
    const response = await fetch(new URL("./fixtures/spec29/pre-race-teams-655.jpeg", import.meta.url));
    if (!response.ok) throw new Error(`Cannot load pre-race capture: ${response.status}`);
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext("2d")!;
    context.drawImage(await createImageBitmap(await response.blob()), 0, 0);
    const cards = [
      [0, 0],
      [0, 1],
      [0, 3],
      [0, 4],
      [0, 6],
      [0, 7],
      [0, 9],
      [0, 10],
      [1, 0],
      [1, 3],
      [1, 9],
    ];
    for (const [column, slot] of cards)
      context.drawImage(canvas, 975, 555, 65, 47, 470 + column * 505, 99 + slot * 76, 65, 47);
    const zeros = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    return recognizeImage(zeros, () => {}).result;
  })();
}
