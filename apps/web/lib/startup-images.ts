import { withBase } from "./base-path.ts";

// Portrait rendering sizes, including the current Air/18 Pro/Duo families.
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
// Duo's inner display renders at 2007×2853 before scaling to its physical panel.
export const iphonePortraitScreens = [
  [375, 667, 2], // SE
  [414, 896, 2], // XR, 11
  [375, 812, 3], // X, XS, 11 Pro, mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12–14, 16e, 17e
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [393, 852, 3], // 14/15 Pro, 15/16
  [430, 932, 3], // 14/15 Pro Max, 15/16 Plus
  [402, 874, 3], // 16–18 Pro, 17
  [420, 912, 3], // Air
  [440, 956, 3], // 16–18 Pro Max
  [466, 678, 3], // Duo outer
  [669, 951, 3], // Duo inner
] as const;

export const startupImages = iphonePortraitScreens.map(([width, height, scale]) => ({
  url: withBase(`/icons/startup/${width * scale}x${height * scale}.png`),
  media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: portrait)`,
}));
