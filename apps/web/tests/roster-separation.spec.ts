import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

import { downloadBackup } from "./backup-navigation";
import { useFixedRecognition } from "./fixed-recognition";
import { createMogi } from "./mogi-creation";
import { mogiState, restoreState } from "./mogi-state";
import { openCurrentMogi } from "./settings-navigation";

const truth = JSON.parse(
  readFileSync(new URL("../../../packages/engine/tests/fixtures/mogi-truth.json", import.meta.url), "utf8"),
) as { bot: string; ign: Record<string, string> };
const image = readFileSync(new URL("./fixtures/finish-order-IMG_0353.jpeg", import.meta.url));

/** Mogi A, whose IGNs were learned from earlier races, then the destination mogi with `roster`, open. */
async function afterLearnedMogi(page: Page, roster: string) {
  await useFixedRecognition(page);
  const state = mogiState({ roster: truth.bot, with: { name: "Mogi A" } }, { roster });
  for (const person of state.mogis[0].participants) {
    person.ign = truth.ign[person.loungeName];
    person.ignOrigin = "learned";
  }
  state.activeMogiId = state.mogis[1].id;
  await restoreState(page, state);
  return state.mogis[1].id;
}

async function upload(page: Page) {
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add Screenshots", exact: true }).click();
  await (await picker).setFiles({ name: "race-1.jpeg", mimeType: "image/jpeg", buffer: image });
}

/** ⌘V of the fixture with focus on the page; returns the confirmation sheet. */
async function paste(page: Page) {
  await page.evaluate(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "image.jpeg", { type: "image/jpeg" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [...image],
  );
  const sheet = page.getByRole("dialog", { name: "Pasted Screenshot", exact: true });
  await expect(sheet.getByRole("img", { name: "Pasted screenshot", exact: true })).toBeVisible();
  return sheet;
}

test("a pasted image of another roster waits for confirmation, then asks first and Yes keeps it at the destination", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const destination = await afterLearnedMogi(
    page,
    `Tier D\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. Other ${i + 1}`).join("\n")}`,
  );
  // A paste waits for confirmation: Cancel stores nothing, Add to Mogi goes through intake.
  let pasted = await paste(page);
  await pasted.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(pasted).toBeHidden();
  const cancelled = JSON.parse(
    strFromU8(unzipSync(readFileSync(await downloadBackup(page, info.outputPath("cancelled.zip"))))["manifest.json"]),
  ).state;
  expect(cancelled.sharedReceipts ?? []).toEqual([]);
  await openCurrentMogi(page);
  pasted = await paste(page);
  await pasted.getByRole("button", { name: "Add to Mogi", exact: true }).click();
  const header = page.getByRole("button", { name: "1 Question", exact: true });
  await expect(header).toBeVisible({ timeout: 30000 });
  await header.click();
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await expect(question).toHaveAccessibleName("Question 1 of 1");
  await expect(question.getByText("Is this screenshot from this mogi?", { exact: true })).toBeVisible();
  await expect(question.getByText("It looks like Mogi A.", { exact: true })).toBeVisible();
  await expect(question.getByRole("img", { name: "Screenshot", exact: true })).toBeVisible();
  // "No, remove it" is the ingestion rule's other outcome (lib/mogi/ingestion.test.ts).
  await expect(question.getByRole("radio", { name: "Yes, add it here Suggested", exact: true })).toBeChecked();
  await question.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(question).toHaveAccessibleName(/^Question 2 of \d+$/);
  await expect(question.getByText(/^Who is “.+”\?$/)).toBeVisible();
  await expect(question.getByText("Which race is this?", { exact: true })).toHaveCount(0);
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /^\d+ Questions?$/ })).toBeVisible();
  const files = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("accepted.zip"))));
  const state = JSON.parse(strFromU8(files["manifest.json"])).state;
  expect(state.mogis.find((mogi: { id: string }) => mogi.id === destination).captures).toHaveLength(1);
  expect(state.mogis.find((mogi: { id: string }) => mogi.id === destination).captureReview).toBeUndefined();
  expect(state.sharedReceipts?.flatMap((receipt: { files: unknown[] }) => receipt.files) ?? []).toEqual([]);
});

test("consecutive mogis with the same roster receive the capture and identify repeated images", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const destination = await afterLearnedMogi(page, truth.bot);
  await upload(page);
  const header = page.getByRole("button", { name: /^\d+ Questions?$/ });
  await expect(header).toBeVisible({ timeout: 30000 });
  await header.click();
  const question = page.getByRole("dialog", { name: /^Question \d+ of \d+$/ });
  await expect(question.getByText("Is this screenshot from this mogi?", { exact: true })).toHaveCount(0);
  await expect(question.getByText(/^Who is “.+”\?$/)).toBeVisible();
  await expect(question.getByText("Which race is this?", { exact: true })).toHaveCount(0);
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(header).toBeVisible();
  const pasted = await paste(page);
  await expect(pasted.getByText("Already in this mogi", { exact: true })).toBeVisible();
  await expect(pasted.getByRole("button", { name: "Add to Mogi", exact: true })).toHaveCount(0);
  await pasted.getByRole("button", { name: "Close", exact: true }).click();
  await upload(page);
  await expect(page.locator("[aria-live=polite]").filter({ hasText: "Screenshot already in this mogi" })).toBeVisible();
  const files = unzipSync(readFileSync(await downloadBackup(page, info.outputPath("received.zip"))));
  const mogi = JSON.parse(strFromU8(files["manifest.json"])).state.mogis.find(
    (entry: { id: string }) => entry.id === destination,
  );
  expect(mogi.captures).toHaveLength(1);
  expect(mogi.captureReview).toBeUndefined();
  await openCurrentMogi(page);
  await createMogi(page, truth.bot);
  await upload(page);
  await expect(
    page.locator("[aria-live=polite]").filter({ hasText: `Screenshot already in ${mogi.name}` }),
  ).toBeVisible();
});
