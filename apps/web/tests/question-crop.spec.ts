import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup } from "./backup-navigation";
import { type Loose, mogiState, restoreState, stateBackup } from "./mogi-state";
import { nameQuestions } from "./question-fixture";
import { openBackup } from "./settings-navigation";

const directory = process.env.BATCH_CAPTURES_DIR;

/** Two unread names on the real pre-race screen, one per column; `invalidX` moves the first name's bounds off the image. */
function cropState(original: Uint8Array<ArrayBuffer>, legacy: boolean, invalidX?: number) {
  const state = nameQuestions(
    mogiState({ roster: `Tier D\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. Piloto ${i + 1}`).join("\n")}` }),
    [],
    2,
  );
  const mogi: Loose = state.mogis[0],
    capture = mogi.captures[0];
  Object.assign(capture, {
    fileName: "11_antes-corrida-11_IMG_0343.jpeg", // english-check: data (original capture filename)
    context: { phase: "before", raceId: "question-race" },
    interpretation: {
      version: 1,
      screen: "twoColumnsByTeam",
      origin: "visual",
      positions: [],
      movementRows: [],
      reasons: [],
    },
    original: new Blob([original], { type: "image/jpeg" }),
  });
  for (const [column, text] of ["Tavo", "KR♪Funk"].entries()) {
    const i = column * 6;
    capture.rows[i].text = text;
    capture.rows[i].uncertain = true;
    capture.nameAssociations[i] = { participantId: null };
    capture.rows[i].location = { x: 140 + 505 * column, y: 99, width: 315, height: 47 };
    if (!legacy) capture.rows[i].bounds = { x: column ? 550 : (invalidX ?? 45), y: 89, width: 490, height: 67 };
  }
  capture.rows[1].text = mogi.participants[1].ign;
  capture.nameAssociations[1] = { participantId: mogi.participants[1].id };
  return state;
}

test.skip(!directory, "Set BATCH_CAPTURES_DIR for the real pre-race crop.");
for (const legacy of [false, true])
  test(`pre-race crops the full card in each column (${legacy ? "legacy" : "bounds"}) and requires a choice without evidence`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const original = readFileSync(path.join(directory!, "11_antes-corrida-11_IMG_0343.jpeg")); // english-check: data (original capture filename)
    if (!legacy) {
      await page.goto("/");
      await openBackup(page);
      await page
        .getByLabel("Restore from file")
        .setInputFiles(await stateBackup(cropState(original, legacy, 1900), "invalid-bounds.zip"));
      await expect(page.getByRole("alert")).toContainText("Name region is outside the screenshot");
      await expect(page.getByRole("heading", { name: "Restore", exact: true })).toHaveCount(0);
    }
    await restoreState(page, cropState(original, legacy));
    await page.getByRole("button", { name: "2 Questions", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
    for (const column of [0, 1]) {
      await expect(sheet.getByRole("radio", { checked: true })).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
      const crop = sheet.getByRole("img", { name: `Screenshot row ${column * 6 + 1}`, exact: true });
      await expect(crop).toHaveAttribute("width", "496");
      await expect(crop).toHaveAttribute("height", "73");
      // Compare drawn pixels with the original card, including the 3px margin.
      const measurement = await crop.evaluate(
        async (element, args) => {
          const canvas = element as HTMLCanvasElement;
          const bitmap = await createImageBitmap(new Blob([new Uint8Array(args.bytes)], { type: "image/jpeg" }));
          const expected = document.createElement("canvas");
          expected.width = 496;
          expected.height = 73;
          expected
            .getContext("2d")!
            .drawImage(
              bitmap,
              ((42 + args.column * 505) * bitmap.width) / 1920,
              (86 * bitmap.height) / 1080,
              (496 * bitmap.width) / 1920,
              (73 * bitmap.height) / 1080,
              0,
              0,
              496,
              73,
            );
          bitmap.close();
          const actualPixels = canvas.getContext("2d")!.getImageData(0, 0, 496, 73).data;
          const expectedPixels = expected.getContext("2d")!.getImageData(0, 0, 496, 73).data;
          return {
            mismatches: actualPixels.reduce((sum, value, i) => sum + Number(value !== expectedPixels[i]), 0),
            bounds: { x: 42 + args.column * 505, y: 86, width: canvas.width, height: canvas.height },
          };
        },
        { bytes: [...original], column },
      );
      expect(measurement.mismatches).toBe(0);
      expect(measurement.bounds.x + measurement.bounds.width).toBeLessThanOrEqual(column === 0 ? 550 : 1055);
      await info.attach(`bounds-${column}`, { body: JSON.stringify(measurement), contentType: "application/json" });
      await crop.screenshot({ path: info.outputPath(`crop-${column === 0 ? "left" : "right"}.png`) });
      await page.screenshot({
        path: info.outputPath(`sheet-${column === 0 ? "left" : "right"}.png`),
        animations: "disabled",
      });
      if (column === 0) await sheet.getByRole("button", { name: "Not Sure", exact: true }).click();
    }
    await sheet.getByRole("radio").first().check();
    await expect(sheet.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    const saved = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("crop-roundtrip.zip"))));
    const persisted = JSON.parse(strFromU8(saved["manifest.json"])).state.mogis[0].captures[0];
    expect(persisted.rows[0].bounds).toEqual(legacy ? undefined : { x: 45, y: 89, width: 490, height: 67 });
    expect(persisted.rows[6].bounds).toEqual(legacy ? undefined : { x: 550, y: 89, width: 490, height: 67 });
    expect(Buffer.from(saved[persisted.original.path])).toEqual(original);
  });
