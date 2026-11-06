import { expect, test } from "@playwright/test";

import { openMogiSettings } from "./mogi-navigation";
import { ffaRoster, type Loose, mogiState, restoreState } from "./mogi-state";
import { nameQuestions, roomQuestions } from "./question-fixture";

for (const width of [375]) {
  test(`names can be unlinked or corrected and pending opens its own queued question at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = nameQuestions(mogiState({ roster: ffaRoster() }), [3]);
    const mogi: Loose = state.mogis[0],
      capture = mogi.captures[1];
    mogi.participants[11].loungeName = "Raindrop";
    mogi.participants[11].ign = "Raindrop";
    mogi.captures[0].rows[11].text = "Wet";
    mogi.captures[0].rows[11].uncertain = true;
    capture.rows[0].text = "Other reading";
    capture.rows[1].text = "Another reading";
    capture.rows[10].text = "Funky";
    capture.rows[10].uncertain = true;
    capture.rows[11].text = "Raindro";
    capture.rows[11].uncertain = true;
    capture.nameAssociations[11] = { participantId: null };
    await restoreState(page, state);
    await openMogiSettings(page);
    await page.getByRole("button", { name: "Screenshots (2)", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Screenshots", exact: true })
      .getByRole("button", { name: /Race 3 · after the race/ })
      .click();
    const image = page.getByRole("dialog", { name: "Screenshot 2", exact: true });
    await expect
      .poll(() => image.getByRole("listitem").evaluateAll((rows) => rows.slice(0, 4).map((row) => row.textContent)))
      .toEqual(["Race3", "MomentAfter the race", "ScreenFinish order, points added", "Pending names2"]);
    const section = image.getByRole("list", { name: "How this was counted", exact: true });
    await expect(section.getByRole("listitem")).toHaveCount(5);
    const summary = section.getByRole("listitem", { name: "8 of 12 names, as shown, Read", exact: true });
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("button")).toHaveCount(0);
    await expect(section.getByText(/Player \d+ is Player \d+/)).toHaveCount(0);
    const deduced = section.getByRole("button", {
      name: 'Raindro is Raindrop, "raindro" only matches Raindrop, Deduced',
      exact: true,
    });
    await expect(deduced).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Funky is Player 11, as you chose, Your answer", exact: true }),
    ).toBeVisible();
    const pending = section.getByRole("button", { name: "Not counted yet, 2 questions", exact: true });
    await expect(pending).toBeVisible();
    await expect(pending.getByText("Deduced", { exact: true })).toHaveCount(0);
    await expect(pending.locator("svg.lucide-chevron-right")).toBeVisible();
    await pending.scrollIntoViewIfNeeded();
    expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await deduced.click();
    const correction = page.getByRole("dialog", { name: "Raindrop", exact: true });
    await correction.getByRole("button", { name: "Unlink Raindro", exact: true }).click();
    await expect(image).toBeVisible();
    await expect(deduced).toHaveCount(0);
    await section.getByRole("button", { name: "Not counted yet, 3 questions", exact: true }).click();
    const question = page.getByRole("dialog", { name: /Question \d+ of \d+/ });
    await expect(question.getByText("Who is “Other reading”?", { exact: true })).toBeVisible();
    await expect(question.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(image).toBeVisible();
    await expect(image.getByRole("button", { name: "Not counted yet, 3 questions", exact: true })).toBeFocused();
    await section.getByRole("button", { name: "Funky is Player 11, as you chose, Your answer", exact: true }).click();
    const chosen = page.getByRole("dialog", { name: "Player 11", exact: true });
    await chosen.getByRole("button", { name: "Raindrop", exact: true }).click();
    await expect(
      section.getByRole("button", { name: "Funky is Raindrop, as you chose, Your answer", exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Funky is Player 11, as you chose, Your answer", exact: true }),
    ).toHaveCount(0);
  });
  test(`image explains race, order, repetition and points, shows raw numbers and updates after correction at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = roomQuestions(mogiState({ roster: ffaRoster() }), "order");
    const mogi: Loose = state.mogis[0];
    // Give each constructed room coherent photo times; the backup carries the moment read on intake.
    mogi.captures.forEach((c: { photoMoment: { at: number; source: string } }, i: number) => {
      c.photoMoment = { at: Date.parse(`2026-10-26T19:32:${i < 2 ? 10 + i : 20 + (i % 2)}-03:00`), source: "exif" };
    });
    const copy = { ...structuredClone({ ...mogi.captures[2], original: null }), original: mogi.captures[2].original };
    copy.id = "room-b-1-copy";
    copy.fileName = "repeat.jpeg";
    copy.rows[0].text = "Raw fifth";
    for (const row of copy.numericRows) row.addition.text = "";
    for (const row of copy.numericRows.slice(0, 2))
      row.right = { ...row.right, text: "", value: null, uncertain: true };
    mogi.captures.push(copy);
    await restoreState(page, state);
    await openMogiSettings(page);
    await page.getByRole("button", { name: "Screenshots (5)", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Screenshots", exact: true })
      .getByRole("button", { name: /repeat.jpeg/ })
      .click();
    const image = page.getByRole("dialog", { name: "Screenshot 5", exact: true });
    await expect(image.getByRole("listitem").filter({ hasText: "MomentAfter the race" })).toHaveCount(1);
    await expect(image.getByRole("listitem").filter({ hasText: "ScreenFinish order, points added" })).toHaveCount(1);
    const section = image.getByRole("list", { name: "How this was counted", exact: true });
    await expect(section.getByRole("listitem")).toHaveCount(8);
    const labels = [
      "Race 3 · first in a new room, most totals went down, Deduced",
      "After screenshot 2, screenshot 2 taken before screenshot 5, Deduced",
      "Same totals as screenshot 3, counted once, Deduced",
      "10 of 12 totals, as shown, Read",
      "Player 5 · 15, 1st place in race 1, Deduced",
      "Player 6 · 12, 2nd place in race 1, Deduced",
    ];
    await expect
      .poll(() =>
        section
          .getByRole("listitem")
          .evaluateAll((rows) => rows.slice(0, 6).map((row) => row.getAttribute("aria-label"))),
      )
      .toEqual(labels);
    for (const label of labels) await expect(section.getByRole("listitem", { name: label, exact: true })).toBeVisible();
    for (const label of labels.slice(3))
      await expect(section.getByRole("listitem", { name: label, exact: true }).getByRole("button")).toHaveCount(0);
    await expect(image.getByRole("heading", { name: "How this was counted", exact: true })).toBeVisible();
    await expect(section).not.toContainText(/corrida|deduzido|reabertura|contabilizad/i); // english-check: data (Portuguese copy that must stay absent)
    await section.scrollIntoViewIfNeeded();
    const bounds = await section.boundingBox();
    const numbers = await image.getByRole("button", { name: "Numbers Read", exact: true }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(numbers!.y + 1);
    expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await image.getByRole("button", { name: "Numbers Read", exact: true }).click();
    const rawNumbers = page.getByRole("dialog", { name: "Numbers Read", exact: true });
    await expect(rawNumbers.getByRole("listitem")).toHaveCount(12);
    await expect(rawNumbers.getByRole("listitem").first()).toHaveText("Row 1Raw fifth—");
    await expect(rawNumbers.getByRole("listitem").nth(2)).toHaveText("Row 3Player 710");
    await rawNumbers.getByRole("button", { name: "Back", exact: true }).click();
    await section.getByRole("button", { name: labels[0], exact: true }).click();
    const race = page.getByRole("dialog", { name: "Race", exact: true });
    await expect(race).toBeVisible();
    await race.getByRole("button", { name: "Race 5", exact: true }).click();
    await expect(section.getByRole("button", { name: "Race 5, as you chose, Your answer", exact: true })).toBeVisible();
    await expect(image.getByRole("button", { name: "Race 5", exact: true })).toBeVisible();
    await expect(section.getByText("Your answer", { exact: true }).first()).toBeVisible();
  });
}
