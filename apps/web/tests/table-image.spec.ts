import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

import type { Mogi } from "@/lib/mogi/types";

import { consultRace, openMogiActions } from "./mogi-navigation";
import { mogiState, restoreState } from "./mogi-state";
import { observedRace } from "./race-fixture";

const roster = `Tier D\n${Array.from({ length: 6 }, (_, index) => `${index + 1}. Player ${index * 2 + 1}, Player ${index * 2 + 2}`).join("\n")}`;
/** `count` manual races, everyone in roster order. */
const manualRaces = (count: number) => (mogi: Mogi) =>
  Array.from({ length: count }, (_, index) => ({
    id: `race-${index + 1}`,
    origin: "manual" as const,
    number: index + 1,
    placements: mogi.participants.map((person) => person.id),
  }));

async function expectImageTitle(image: Locator, subtitle: string) {
  // Compare public PNG pixels with the literal title and approved prototype dimensions.
  const differences = await image.evaluate((element, subtitle) => {
    const image = element as HTMLImageElement;
    const actual = document.createElement("canvas");
    const expected = document.createElement("canvas");
    actual.width = expected.width = 1776;
    actual.height = expected.height = 192;
    const a = actual.getContext("2d")!;
    const e = expected.getContext("2d")!;
    a.drawImage(image, 0, 0);
    e.scale(2, 2);
    const theme = getComputedStyle(document.documentElement);
    e.fillStyle = theme.getPropertyValue("--background").trim();
    e.fillRect(0, 0, 888, 96);
    e.textBaseline = "middle";
    const family = getComputedStyle(document.body).fontFamily;
    e.font = `600 22px ${family}`;
    e.fillStyle = theme.getPropertyValue("--foreground").trim();
    e.fillText("Mogi Tier D · 2v2", 24, 38);
    e.font = `400 15px ${family}`;
    e.fillStyle = theme.getPropertyValue("--muted-foreground").trim();
    e.fillText(subtitle, 24, 66);
    const pixels = a.getImageData(0, 0, 1776, 192).data;
    const reference = e.getImageData(0, 0, 1776, 192).data;
    return pixels.reduce((sum, value, index) => sum + Number(value !== reference[index]), 0);
  }, subtitle);
  expect(differences).toBe(0);
}

test("the partial image has an English title in light and dark themes", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await restoreState(page, observedRace(mogiState({ roster })));
  const race = await consultRace(page, 1);
  await race.getByRole("button", { name: "Track Choose", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("CC");
  await page
    .getByRole("dialog", { name: "Track", exact: true })
    .getByRole("button", { name: "CC Crown City CC", exact: true })
    .click();
  await race.getByRole("button", { name: "Close", exact: true }).click();
  await openMogiActions(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Export", exact: true });
  const image = panel.getByRole("img", { name: "Table preview", exact: true });
  for (const theme of ["light", "dark"] as const) {
    const previous = (await image.count()) ? await image.getAttribute("src") : "";
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
    if (theme === "dark") await expect(image).not.toHaveAttribute("src", previous!);
    await expect(image).toBeVisible();
    await image.evaluate((element) => (element as HTMLImageElement).decode());
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1776);
    expect(await image.evaluate((element) => (element as HTMLImageElement).naturalHeight)).toBe(1796);
    await expectImageTitle(image, "Table after race 1 of 12");
    // The PNG must contain the approved emoji pixels in the 44px symbol below the race number; the 32px square inside it
    // stays clear of the rounded corners.
    const iconDifferences = await image.evaluate(async (element) => {
      const icon = new Image();
      icon.src = "/tracks/CC.webp";
      await icon.decode();
      const actual = document.createElement("canvas"),
        expected = document.createElement("canvas");
      actual.width = expected.width = actual.height = expected.height = 64;
      const a = actual.getContext("2d")!,
        e = expected.getContext("2d")!;
      a.drawImage(element as HTMLImageElement, -592, -264);
      e.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
      e.fillRect(0, 0, 64, 64);
      e.drawImage(icon, -12, -12, 88, 88);
      const pixels = a.getImageData(0, 0, 64, 64).data,
        reference = e.getImageData(0, 0, 64, 64).data;
      return pixels.reduce((sum, value, index) => sum + Number(value !== reference[index]), 0);
    });
    expect(iconDifferences).toBe(0);

    const copyTable = panel.getByRole("button", { name: "Copy Table", exact: true });
    const width = (await copyTable.boundingBox())!.width;
    await copyTable.click();
    const copied = panel.getByRole("button", { name: "Copied", exact: true });
    await expect(copied).toBeVisible();
    // "Copied" takes the label's place without moving the layout, and is announced instead of a toast.
    expect((await copied.boundingBox())!.width).toBe(width);
    await expect(panel.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);
    await expect(page.locator("[data-toast]")).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.clipboard.read())[0].types)).toContain("image/png");
    await panel.getByRole("button", { name: "Copy Share Text", exact: true }).click();
    await expect(
      panel.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Copied", exact: true }) }),
    ).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(
        /^Mogi Tier D · 2v2\nTable after race 1 of 12\nPartial result · 1\/12 counted\nIncluded: 1 · Pending: none\n\nTeams\n1\. Team 1 — 27/,
      );
    const downloading = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Save Image", exact: true }).click();
    const path = info.outputPath(`table-partial-${theme}.png`);
    await (await downloading).saveAs(path);
    await info.attach(`table-partial-${theme}`, { path, contentType: "image/png" });
    // After 1.5 s every copy action returns to its label.
    await expect(panel.getByRole("button", { name: "Copy Share Text", exact: true })).toBeVisible();
    await expect(copyTable).toBeVisible();
  }
});

test("the final image becomes partial when one of twelve races is discarded", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = mogiState({ roster, races: manualRaces(12) });
  state.mogis[0].teams![0].tag = "VS";
  await restoreState(page, state);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: "Copy !submit", exact: true })).toBeVisible();

  await openMogiActions(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Export", exact: true });
  const image = panel.getByRole("img", { name: "Table preview", exact: true });
  await expect(image).toBeVisible();
  await image.evaluate((element) => (element as HTMLImageElement).decode());
  await expectImageTitle(image, "Final table");
  // The chosen tag and English fallback occupy the name column, without a leading badge, like the wide table.
  const labelDifferences = await image.evaluate((element) => {
    return ["VS", "Team 2"].map((label, index) => {
      const actual = document.createElement("canvas"),
        expected = document.createElement("canvas");
      actual.width = expected.width = 248;
      actual.height = expected.height = 64;
      const a = actual.getContext("2d")!,
        e = expected.getContext("2d")!;
      a.drawImage(element as HTMLImageElement, -128, -(360 + index * 216));
      e.scale(2, 2);
      const theme = getComputedStyle(document.documentElement);
      e.fillStyle = theme.getPropertyValue("--muted").trim();
      e.fillRect(0, 0, 124, 32);
      e.fillStyle = theme.getPropertyValue("--rule").trim();
      e.fillRect(0, 0, 124, 1);
      e.fillRect(0, 31, 124, 1);
      e.font = `700 14px ${getComputedStyle(document.body).fontFamily}`;
      e.fillStyle = theme.getPropertyValue("--foreground").trim();
      e.textBaseline = "middle";
      e.fillText(label, 0, 16, 124);
      const pixels = a.getImageData(0, 0, 248, 80).data,
        reference = e.getImageData(0, 0, 248, 80).data;
      return pixels.reduce((sum, value, offset) => sum + Number(value !== reference[offset]), 0);
    });
  });
  expect(labelDifferences).toEqual([0, 0]);
  await panel.getByRole("button", { name: "Copy Share Text", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(
      /^Mogi Tier D · 2v2\nFinal table\nFinal result · 12\/12 counted\nIncluded: [^\n]+\n\nTeams\n1\. VS — 324\n[^\n]+\n[^\n]+\n\n2\. Team 2 — 228/,
    );
  await expect(panel.getByLabel("!submit", { exact: true })).toHaveValue(
    "!submit 2 D\nPlayer 1 180\nPlayer 2 144\n\nPlayer 3 120\nPlayer 4 108\n\nPlayer 5 96\nPlayer 6 84\n\nPlayer 7 72\nPlayer 8 60\n\nPlayer 9 48\nPlayer 10 36\n\nPlayer 11 24\nPlayer 12 12",
  );
  await expect(panel.getByRole("button", { name: "Copy !submit", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  const race = await consultRace(page, 12);
  await race.getByRole("button", { name: "Don't Count This Race", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Don't Count Race 12?", exact: true })
    .getByRole("button", { name: "Don't Count", exact: true })
    .click();
  await expect(race).toBeHidden();
  await expect(page.getByRole("button", { name: "Copy Table", exact: true })).toHaveCount(1);
  await openMogiActions(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(image).toBeVisible();
  await image.evaluate((element) => (element as HTMLImageElement).decode());
  await expectImageTitle(image, "Table after race 11 of 12");
  await panel.getByRole("button", { name: "Copy Share Text", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^Mogi Tier D · 2v2\nTable after race 11 of 12\nPartial result · 11\/12 counted/);
  await expect(panel.getByRole("list", { name: "!submit", exact: true })).toHaveText("!submitWaiting on race 12");
  await expect(panel.getByRole("button", { name: "Copy Table", exact: true })).toBeEnabled();
});

test("the full table opens at the last race, checks 82 per race and changes placement with width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await restoreState(page, mogiState({ roster, races: manualRaces(11) }));

  // A resolved race's Tracks row opens what its column opens: the track picker.
  await page.getByRole("list", { name: "Tracks", exact: true }).getByRole("button").nth(10).click();
  await expect(page.getByRole("dialog", { name: "Race 11 Track", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // compact: Menu → Table opens the sheet, with race 11 in view.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Table After Race 11", exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Copy Table", exact: true })).toBeVisible();
  const table = sheet.getByRole("table", { name: "Mogi table", exact: true });
  const totals = table.locator("tfoot tr:last-child td");
  await expect(totals).toHaveText(["", "902", ...Array(11).fill("82"), "·", ""]);
  const layout = await table.evaluate((element) => {
    const scroller = element.parentElement!;
    const current = element.querySelector<HTMLElement>("thead th[data-current]")!;
    const first = element.querySelector<HTMLElement>("thead th")!;
    const spacer = element.querySelector<HTMLElement>("thead th:last-child")!;
    const probe = document.createElement("span");
    probe.className = "border-rule";
    document.body.appendChild(probe);
    const rule = getComputedStyle(probe).borderTopColor;
    probe.remove();
    const scrollerBox = scroller.getBoundingClientRect();
    return {
      scrolled: scroller.scrollLeft,
      currentRight: current.getBoundingClientRect().right,
      scrollerRight: scrollerBox.right,
      firstLeft: first.getBoundingClientRect().left - scrollerBox.left,
      padding: getComputedStyle(first).paddingLeft,
      spacer: spacer.getBoundingClientRect().width,
      rule,
      divider: getComputedStyle(element.querySelector("tbody td")!).borderTopColor,
    };
  });
  expect(layout.scrolled).toBeGreaterThan(0);
  expect(layout.currentRight).toBeLessThanOrEqual(layout.scrollerRight);
  expect(layout.firstLeft).toBe(0);
  expect(layout.padding).toBe("16px");
  expect(layout.spacer).toBe(16);
  expect(layout.divider).toBe(layout.rule);

  // The race number opens the track picker as a page of the Table sheet; choosing returns to the table, on that column.
  await table.getByRole("button", { name: "Race 11 Track, No Track", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Race 11 Track", exact: true });
  await picker.getByRole("searchbox", { name: "Search track or code", exact: true }).fill("crown");
  await picker.getByRole("button", { name: "CC Crown City CC", exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(table.getByRole("button", { name: "Race 11 Track, Crown City", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();

  // narrow regular: Table is under More; wide: the table sits below Standings and Tracks.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Table", exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("heading", { name: "Table", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Table", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "More", exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Tracks", exact: true })).toBeVisible();
  // A section title sits the same gap above its content's first ink: the table's race numbers as a row's symbol.
  const titleGaps = await page.locator("main").evaluate((main) =>
    ["Tracks", "Table"].map((name) => {
      const title = [...main.querySelectorAll("h2")].find((heading) => heading.textContent === name)!;
      const content = title.nextElementSibling!;
      const ink = parseFloat(getComputedStyle(content).getPropertyValue("--ink-top"));
      return content.getBoundingClientRect().top + ink - title.getBoundingClientRect().bottom;
    }),
  );
  expect(Math.max(...titleGaps) - Math.min(...titleGaps)).toBeLessThanOrEqual(1);
  // wide: the column opens the Track sheet on its own, which closes on choosing and returns focus to the column.
  const column = page.getByRole("button", { name: "Race 11 Track, Crown City", exact: true });
  await column.click();
  const trackSheet = page.getByRole("dialog", { name: "Race 11 Track", exact: true });
  await trackSheet.getByRole("button", { name: "MBC Mario Bros. Circuit MBC", exact: true }).click();
  await expect(trackSheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Race 11 Track, Mario Bros. Circuit", exact: true })).toBeFocused();
});
