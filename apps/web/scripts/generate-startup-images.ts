import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { iphonePortraitScreens, startupImages } from "../lib/startup-images.ts";

const publicRoot = new URL("../public/", import.meta.url);
await mkdir(new URL("icons/startup/", publicRoot), { recursive: true });
for (const [index, [width, height, scale]] of iphonePortraitScreens.entries()) {
  const size = 96 * scale;
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="100%" height="100%" rx="${size * 0.22}" fill="white"/></svg>`,
  );
  const icon = await sharp(fileURLToPath(new URL("icons/icon-512.png", publicRoot)))
    .resize(size, size)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  // The light --background token is white; iOS startup images deliberately use it.
  await sharp({ create: { width: width * scale, height: height * scale, channels: 3, background: "#ffffff" } })
    .composite([
      { input: icon, left: Math.round((width * scale - size) / 2), top: Math.round((height * scale - size) / 2) },
    ])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(fileURLToPath(new URL(startupImages[index].url.slice(1), publicRoot)));
}
console.log(`Generated ${startupImages.length} portrait startup images from icon-512.png.`);
