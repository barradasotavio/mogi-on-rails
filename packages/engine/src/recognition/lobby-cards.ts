/** Pixel rules that tell a filled lobby card from an empty slot on the pre-race board, by its top edge and body. */
import type { PixelImage } from "./track-banner.ts";

const sampleX = 400; // Left edge of the 40-pixel strip sampled in the first column, past the name.
const sampleWidth = 40;
const columnStep = 505; // Distance between the two columns of cards.
const slotStep = 76; // Distance between two card slots in a column.
const edgeTop = 87; // The card's lit top edge falls within nine rows from here.
const edgeRows = 9;
const insideRow = 104; // A row through the card's body.
const outsideRow = 84; // A row in the gap above the card.
const cardEdge = 16; // A card's top edge stands this much brighter than the gap above it.
const litEdge = 8; // A neutral card's lit edge stands this much brighter than its body.
const coloredBody = 140; // A team's filled card has a channel above this; its empty slot stays below 100.
const coloredSpread = 60; // A filled team card's channels spread at least this much; neutral cards are grey.

function strip(image: PixelImage, column: number, y: number) {
  const channels = [0, 0, 0];
  let light = 0;
  for (let x = sampleX + column * columnStep; x < sampleX + column * columnStep + sampleWidth; x++) {
    const n = (y * image.width + x) * 4;
    const [r, g, b] = [image.data[n], image.data[n + 1], image.data[n + 2]];
    light += (r * 299 + g * 587 + b * 114) / 1000 / sampleWidth;
    channels[0] += r / sampleWidth;
    channels[1] += g / sampleWidth;
    channels[2] += b / sampleWidth;
  }
  return { light, channels };
}

/**
 * A filled card: a top edge brighter than the gap above it, and either a lit edge over a neutral body or a bright,
 * saturated team-coloured body. Empty slots are darker; some team colours (green) light the edge no brighter than
 * the body, so the body alone decides those.
 */
export function occupiedCard(image: PixelImage, column: number, slot: number): boolean {
  const y = (row: number) => row + slot * slotStep;
  const edge = Math.max(...Array.from({ length: edgeRows }, (_, n) => strip(image, column, y(edgeTop + n)).light));
  const inside = strip(image, column, y(insideRow));
  const outside = strip(image, column, y(outsideRow)).light;
  const high = Math.max(...inside.channels);
  const colored = high > coloredBody && high - Math.min(...inside.channels) > coloredSpread;
  return edge > outside + cardEdge && (edge > inside.light + litEdge || colored);
}
