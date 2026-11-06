/** Pixel rules that find the pre-race map label, the dark banner naming the next track, wherever the map puts it. */

export interface PixelImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface BannerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const mapLeft = 1040; // The player cards end here on a 1920-wide capture; the map fills the rest.
const letterGap = 24; // The widest white stroke run inside a letter; farther white is map ground.
const colorStreak = 4; // JPEG fringes tint a pixel or two; colored ground beside the banner is a longer streak.
const letterRowWhite = 8; // A row through the letters has at least a few white pixels on black.
const letterBacking = 0.4; // Bold letters can outweigh the black between them, but never by much.
const brokenRows = 3; // A row the letters leave almost blank (between accents and caps) does not end the label.
const letterMinRows = 12; // Capital letters are about 20 rows tall.
const letterMaxRows = 40; // Taller white-on-black areas are map art, not a label.
const labelMinWhite = 150; // The shortest name still has this many letter pixels.
const cropHeight = 45; // The crop the OCR reads well: the letters with a band of banner around them.
const cropMargin = 16; // Keeps the first and last letters off the crop's edge.

const black = (r: number, g: number, b: number) => Math.max(r, g, b) < 70 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
const white = (r: number, g: number, b: number) =>
  Math.min(r, g, b) > 180 && Math.max(r, g, b) - Math.min(r, g, b) < 70;

interface LetterRow {
  y: number;
  white: number;
  left: number;
  right: number;
}

/** White pixels enclosed by black within one row: letters on the banner, not white ground beside it. */
export function letterRow(image: PixelImage, y: number): LetterRow | undefined {
  let best: LetterRow | undefined;
  let run: LetterRow | undefined;
  let lastBlack = -1,
    blacks = 0,
    pending: number[] = [],
    colored = 0;
  const close = () => {
    if (run && run.white >= letterRowWhite && blacks >= letterBacking * run.white && (!best || run.white > best.white))
      best = run;
    run = undefined;
    blacks = 0;
    pending = [];
  };
  for (let x = mapLeft; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    const [r, g, b] = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    colored = Math.max(r, g, b) - Math.min(r, g, b) >= 48 ? colored + 1 : 0;
    if (black(r, g, b)) {
      run ??= { y, white: 0, left: x, right: x };
      if (pending.length) {
        run.left = Math.min(run.left, pending[0]);
        run.right = Math.max(run.right, pending.at(-1)!);
        run.white += pending.length;
        pending = [];
      }
      lastBlack = x;
      blacks++;
    } else if (!run) continue;
    else if (x - lastBlack > letterGap || colored >= colorStreak) close();
    else if (white(r, g, b)) pending.push(x);
  }
  close();
  return best?.white ? best : undefined;
}

/** Groups letter rows into labels and keeps the one with the most letter pixels; the crop centers on its letters. */
export function trackBanner(image: PixelImage): BannerBox | undefined {
  const labels: LetterRow[][] = [];
  let current: LetterRow[] = [];
  for (let y = 0; y < image.height; y++) {
    const row = letterRow(image, y);
    const last = current.at(-1);
    if (last && y - last.y > brokenRows + 1) {
      labels.push(current);
      current = [];
    }
    if (!row) continue;
    const left = Math.min(...current.map((entry) => entry.left));
    const right = Math.max(...current.map((entry) => entry.right));
    if (current.length && (row.right < left || row.left > right)) {
      labels.push(current);
      current = [];
    }
    current.push(row);
  }
  if (current.length) labels.push(current);
  const rows = (label: LetterRow[]) => label.at(-1)!.y - label[0].y + 1;
  const letters = (label: LetterRow[]) => label.reduce((sum, row) => sum + row.white, 0);
  const best = labels
    .filter((label) => rows(label) >= letterMinRows && rows(label) <= letterMaxRows && letters(label) >= labelMinWhite)
    .sort((a, b) => letters(b) - letters(a))[0];
  if (!best) return;
  const left = Math.max(0, Math.min(...best.map((row) => row.left)) - cropMargin);
  const right = Math.min(image.width, Math.max(...best.map((row) => row.right)) + cropMargin);
  const middle = Math.round((best[0].y + best.at(-1)!.y) / 2);
  const top = Math.max(0, Math.min(image.height - cropHeight, middle - Math.floor(cropHeight / 2)));
  return { x: left, y: top, width: right - left, height: cropHeight };
}
