import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { importedPhotoMoment, readPhotoMoment } from "./photo-moment.ts";

const jpeg = new Uint8Array(readFileSync(new URL("../../tests/fixtures/finish-order-IMG_0353.jpeg", import.meta.url)));

test("the real JPEG IMG_0353 keeps DateTimeOriginal with its timezone, even when renamed", () => {
  assert.deepEqual(readPhotoMoment(jpeg, "2026102812000000-0123456789ABCDEF0123456789ABCDEF.jpg"), {
    at: Date.parse("2026-10-27T10:37:55-03:00"),
    source: "exif",
  });
});

function withoutExif(bytes = jpeg) {
  const start = bytes.findIndex(
    (_, i) =>
      bytes[i] === 0xff &&
      bytes[i + 1] === 0xe1 &&
      String.fromCharCode(...bytes.subarray(i + 4, i + 10)) === "Exif\0\0",
  );
  assert.ok(start > 0);
  const length = bytes[start + 2] * 256 + bytes[start + 3];
  return new Uint8Array([...bytes.subarray(0, start), ...bytes.subarray(start + 2 + length)]);
}

test("the full Switch name provides local time, but an isolated or impossible date does not", () => {
  const bytes = withoutExif();
  assert.deepEqual(readPhotoMoment(bytes, "2026102710375500-0123456789ABCDEF0123456789ABCDEF.jpg"), {
    at: new Date(2026, 9, 27, 10, 37, 55).getTime(),
    source: "switch-name",
  });
  for (const name of [
    "IMG_0353.jpeg",
    "20261027103755.jpg",
    "2026102710375500.jpg",
    "2026023010375500-0123456789ABCDEF0123456789ABCDEF.jpg",
    "2026102724375500-0123456789ABCDEF0123456789ABCDEF.jpg",
    "copy-2026102710375500-0123456789ABCDEF0123456789ABCDEF.jpg",
  ])
    assert.equal(readPhotoMoment(bytes, name), undefined);
});

test("without EXIF pasting uses the instant plus index and file dates require more than 60 s", () => {
  const bytes = withoutExif(),
    receivedAt = Date.parse("2026-10-29T17:05:06Z");
  assert.deepEqual(
    importedPhotoMoment(bytes, "pasted.jpeg", { receivedAt, lastModified: receivedAt, pastedAt: receivedAt + 1 }),
    {
      at: receivedAt + 1,
      source: "pasted",
    },
  );
  assert.deepEqual(
    importedPhotoMoment(jpeg, "pasted.jpeg", { receivedAt, lastModified: receivedAt, pastedAt: receivedAt }),
    {
      at: Date.parse("2026-10-27T10:37:55-03:00"),
      source: "exif",
    },
  );
  for (const age of [0, 59999, 60000, -60001])
    assert.equal(importedPhotoMoment(bytes, "copy.jpeg", { receivedAt, lastModified: receivedAt - age }), undefined);
  assert.deepEqual(importedPhotoMoment(bytes, "copy.jpeg", { receivedAt, lastModified: receivedAt - 60001 }), {
    at: receivedAt - 60001,
    source: "file-date",
  });
  assert.equal(importedPhotoMoment(bytes, "unknown.jpeg", { receivedAt, lastModified: 0 }), undefined);
  assert.equal(importedPhotoMoment(bytes, "unknown.jpeg", { receivedAt, lastModified: -1 }), undefined);
});

test("a Switch capture's own DateTime is its moment when DateTimeOriginal is absent", () => {
  // Big-endian TIFF with one main-directory entry, DateTime (0x0132), as the Switch writes it.
  const date = [...new TextEncoder().encode("2026:11:04 02:07:29"), 0];
  const tiff = [
    0x4d,
    0x4d,
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x32,
    0,
    2,
    0,
    0,
    0,
    date.length,
    0,
    0,
    0,
    26,
    0,
    0,
    0,
    0,
    ...date,
  ];
  const app1 = [...new TextEncoder().encode("Exif\0\0"), ...tiff];
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1.length + 2) >> 8,
    (app1.length + 2) & 0xff,
    ...app1,
    0xff,
    0xd9,
  ]);
  assert.deepEqual(readPhotoMoment(bytes, "20261104-01M6MKX0Y0R050HKATA132WVNW.jpeg"), {
    at: new Date(2026, 10, 4, 2, 7, 29).getTime(),
    source: "exif",
  });
});
