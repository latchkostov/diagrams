import { currentDiagram } from "./fixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors, openShareChooser, pageLoadTimeout } from "./fixtures";

// File ▸ Share… (docs/DESIGN-REVIEW.md, round 27): one row in the File menu opens every way out, each saying who can
// open what it makes. The private and controlled ones come first and take the keyboard; the public ones sit last,
// behind a deliberate step; a Private diagram lists only what it allows. The first Import report of an
// infrastructure file offers New diagrams are private, once. The self-hosted builds (no share links) are checked in
// self-host.spec.ts and self-host-locked.spec.ts, which run against those builds (expectShareWithoutLinks).
// Every diagram here is public or synthetic.

const SLUG = "kafka-order-pipeline";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const COMPOSE = readFileSync(join(process.cwd(), "tests", "fixtures", "imports", "compose", "docker-compose.yml"));

/** Share…'s rows, in the order they're shown (and walked by the arrow keys). */
/** A diagram of your own, kept in Your diagrams. Returns its slug. */
async function importOwn(page: Page, title: string) {
  await page.getByTestId("import-input").setInputFiles({
    name: "plan.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "diagrams/v1",
        title,
        nodes: [{ id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 }],
        edges: [],
      }),
    ),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
  return currentDiagram(page);
}

/** The chooser's own chunk (or its source module on the dev server). */
const CHOOSER_CHUNK = /\/(?:assets\/ShareChooser-[A-Za-z0-9_-]+\.js|src\/interop\/ui\/ShareChooser\.tsx)(?:\?.*)?$/;

const rows = (page: Page) =>
  page
    .getByTestId("share-chooser")
    .getByTestId(/^share-(option-|public-toggle$|make-not-private$)/)
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.testid));

async function makePrivate(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("private-badge")).toBeVisible();
  await page.keyboard.press("Escape");
}

/** A docker-compose import: an infrastructure file, so it has an Import report (the toast's Details). */
async function importCompose(page: Page) {
  await page
    .getByTestId("import-input")
    .setInputFiles({ name: "docker-compose.yml", mimeType: "application/yaml", buffer: COMPOSE });
  await expect(page.getByTestId("diagram-title")).toHaveText("shop", { timeout: pageLoadTimeout() });
  await page.getByTestId("toast-import-details").click();
  await expect(page.getByTestId("import-report")).toBeVisible();
}

test("one File menu row, and Share… lists the safe ways first, with the keyboard on the first", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("file-button").click();
  const menu = page.getByTestId("file-menu");
  await expect(menu.getByTestId("file-share")).toContainText("Files, embeds and links, safest first");
  // The three link rows it replaced are gone.
  for (const id of ["export-share-link", "export-share-link-password", "export-embed"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await page.getByTestId("file-share").click();
  await expect(page.getByTestId("share-chooser")).toBeVisible();

  expect(await rows(page)).toEqual([
    "share-option-html",
    "share-option-file",
    "share-option-embed",
    "share-option-password",
    "share-public-toggle",
  ]);
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  // The arrows walk the rows (Home and End too), and stop at either end.
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("share-option-file")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("share-public-toggle")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("share-public-toggle")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("share-option-html")).toBeFocused();

  // Enter on the first row: Interactive HTML, which hands over to its own dialog. Esc closes that, and the keyboard
  // goes back to the File button (one level each, never to the page).
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("html-export-dialog")).toHaveCount(0);
  await expect(page.getByTestId("file-button")).toBeFocused();

  // Esc on Share… itself closes it.
  await openShareChooser(page);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await expect(page.getByTestId("file-button")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("the public ways out take a deliberate step, every time", async ({ page, context, consoleErrors }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  await page.evaluate(() => navigator.clipboard.writeText("before"));
  await openShareChooser(page);
  const toggle = page.getByTestId("share-public-toggle");
  // Folded: neither public row is there, so no key can reach one.
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("Public link or embed");
  for (const id of ["share-option-link", "share-option-embed-public"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  // Enter on the first row is never a public one, and Tab from it doesn't skip ahead to one either.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("share-option-file")).toBeFocused();

  // The step: Enter on the toggle shows them, the keyboard stays on the toggle, and nothing is made or copied.
  await page.keyboard.press("End");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(page.getByTestId("share-public-options")).toBeVisible();
  expect(await rows(page)).toEqual([
    "share-option-html",
    "share-option-file",
    "share-option-embed",
    "share-option-password",
    "share-public-toggle",
    "share-option-link",
    "share-option-embed-public",
  ]);
  await expect(page.getByTestId("share-option-link")).toContainText("Public:");
  await expect(page.getByTestId("share-option-embed-public")).toContainText("Public:");
  await expect(page.getByTestId("share-link-dialog")).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("before");

  // Opened again, Share… starts folded: the step is taken each time.
  await page.keyboard.press("Escape");
  await openShareChooser(page);
  await expect(page.getByTestId("share-public-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("share-option-link")).toHaveCount(0);

  // Embed on a public page: a pristine public example embeds by name, or in the link; never the private source here.
  await page.getByTestId("share-public-toggle").click();
  await page.getByTestId("share-option-embed-public").click();
  await expect(page.getByTestId("embed-dialog")).toBeVisible();
  await expect(page.getByTestId("embed-source-example")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("embed-source-inline")).toBeVisible();
  await expect(page.getByTestId("embed-host-note")).toHaveCount(0);
  // One Tab stop; the arrows move and select.
  await page.getByTestId("embed-source-example").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("embed-source-inline")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("embed-inline-note")).toContainText("Share… ▸ Embed in your app");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("Diagram file saves at once; Embed in your app opens the private embed only", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await openShareChooser(page);
  await expect(page.getByTestId("share-option-file")).toContainText(".diagram.json");
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("share-option-file").click()]);
  expect(file.suggestedFilename()).toBe(`${SLUG}.diagram.json`);
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);

  await openShareChooser(page);
  await page.getByTestId("share-option-embed").click();
  await expect(page.getByTestId("embed-dialog")).toBeVisible();
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  for (const id of ["embed-source-example", "embed-source-inline", "embed-open"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  expect(await page.getByTestId("embed-snippet").inputValue()).not.toMatch(/#[de]=|embed=1&example/);
  await page.keyboard.press("Escape");
  expectNoErrors(consoleErrors);
});

test("a Private diagram's Share… lists only what it allows, says why, and how to change it", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await makePrivate(page);
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("file-share")).toContainText("Files, or an embed your app supplies");
  await page.getByTestId("file-share").click();
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  expect(await rows(page)).toEqual([
    "share-option-html",
    "share-option-file",
    "share-option-embed",
    "share-make-not-private",
  ]);
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  await expect(page.getByTestId("share-private-note")).toHaveText(
    "Links and public embeds are off for a private diagram. Make it not private…",
  );

  // How to change it: the Private diagram dialog, its one confirmation. Made not private, Share… lists them all.
  await page.getByTestId("share-make-not-private").click();
  await expect(page.getByTestId("privacy-dialog")).toBeVisible();
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await page.getByTestId("privacy-turn-off").click();
  await expect(page.getByTestId("private-badge")).toHaveCount(0);
  await openShareChooser(page);
  await expect(page.getByTestId("share-private-note")).toHaveCount(0);
  await expect(page.getByTestId("share-option-password")).toBeVisible();
  await expect(page.getByTestId("share-public-toggle")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("made private in another tab while Share… is open, its link rows go and the keyboard stays in it", async ({
  page,
  context,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  // A diagram of your own (an example would become a private copy, leaving this one as it is).
  await page.getByTestId("import-input").setInputFiles({
    name: "plan.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "diagrams/v1",
        title: "Turning plan",
        nodes: [{ id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 }],
        edges: [],
      }),
    ),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Turning plan");
  const slug = await currentDiagram(page);
  await openShareChooser(page);
  await page.getByTestId("share-public-toggle").click();
  await page.getByTestId("share-option-link").focus();

  const other = await context.newPage();
  await gotoCanvas(other, slug);
  await expect(other.getByTestId("diagram-title")).toHaveText("Turning plan");
  await makePrivate(other);
  await other.close();

  for (const id of ["share-option-password", "share-public-toggle", "share-option-link"])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId("share-private-note")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("the right-click's Export ▸ Share… and Ctrl+K open the same chooser", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("canvas-wrap").click({ button: "right", position: { x: 700, y: 60 } });
  await page.getByTestId("context-menu-item-canvas.export").hover();
  for (const id of ["export:share-password", "export:embed"])
    await expect(page.getByTestId(`context-menu-item-${id}`)).toHaveCount(0);
  await page.getByTestId("context-menu-item-export:share").click();
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);

  // Ctrl+K: "link" finds it too (people look for the link).
  await page.getByTestId("canvas-wrap").click({ position: { x: 700, y: 420 } });
  await page.keyboard.press(`${MOD}+k`);
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.getByTestId("command-input").fill("share link");
  const command = page.getByTestId("command-item-action:export:share");
  await expect(command).toContainText("Share…");
  await command.click();
  await expect(page.getByTestId("share-chooser")).toBeVisible();
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  await page.keyboard.press("Escape");
  expectNoErrors(consoleErrors);
});

test("the first Import report offers New diagrams are private, once, including after a reload", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await importCompose(page);
  // Beside Make it private, off: it never turns on by itself.
  await expect(page.getByTestId("import-report-make-private")).toBeVisible();
  const offer = page.getByTestId("import-report-new-private");
  await expect(offer).toBeVisible();
  await expect(offer).not.toBeChecked();
  await expect(page.getByTestId("import-report-offer")).toContainText("New diagrams are private");
  await page.getByTestId("import-report-done").click();
  await expect(page.getByTestId("private-badge")).toHaveCount(0);
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await expect(page.getByTestId("privacy-new-diagrams")).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Asked once: the next import's report (after a reload too) doesn't ask again.
  await page.reload();
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await importCompose(page);
  await expect(page.getByTestId("import-report-make-private")).toBeVisible();
  await expect(page.getByTestId("import-report-offer")).toHaveCount(0);
  await page.getByTestId("import-report-done").click();
  expectNoErrors(consoleErrors);
});

test("Clear everything forgets the Import report's privacy offer", async ({ page, consoleErrors }) => {
  test.slow(); // Initial canvas, the wipe's reload and another canvas navigation.
  await gotoCanvas(page, SLUG);
  await importCompose(page);
  await expect(page.getByTestId("import-report-offer")).toBeVisible();
  await page.getByTestId("import-report-done").click();

  // Clear everything on this device forgets that it asked.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-clear-device").click();
  await expect(page.getByTestId("clear-device-dialog")).toBeVisible();
  await Promise.all([page.waitForEvent("load"), page.getByTestId("clear-device-confirm").click()]);
  await gotoCanvas(page, SLUG);
  await importCompose(page);
  await expect(page.getByTestId("import-report-offer")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("the Import report's New diagrams are private is the File menu setting", async ({ page, consoleErrors }) => {
  await gotoCanvas(page, SLUG);
  await importCompose(page);

  // Ticked, it's the File ▸ Privacy setting: the next import starts Private.
  await page.getByTestId("import-report-new-private").check();
  await page.getByTestId("import-report-done").click();
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await expect(page.getByTestId("privacy-new-diagrams")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page
    .getByTestId("import-input")
    .setInputFiles({ name: "docker-compose.yml", mimeType: "application/yaml", buffer: COMPOSE });
  await expect(page.getByTestId("private-badge")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("a draw.io or diagram file import never asks: only infrastructure files have an Import report", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await page.getByTestId("import-input").setInputFiles({
    name: "plan.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "diagrams/v1",
        title: "Plain plan",
        nodes: [{ id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 }],
        edges: [],
      }),
    ),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Plain plan");
  await expect(page.getByTestId("toast-import-details")).toHaveCount(0);
  // The offer is still unasked: the first infrastructure import's report makes it.
  await importCompose(page);
  await expect(page.getByTestId("import-report-offer")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test(
  "opening Share… exports nothing: only the row picked reads the diagram",
  { tag: "@dev" },
  async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await importOwn(page, "Large plan");
    // An export reads the stored original to keep fields the app doesn't know (getOriginal). The app's own renders read
    // the same key, so only reads made by getOriginal count: the dev server keeps function names in stacks.
    await page.evaluate(() => {
      const w = window as unknown as { __exports: number };
      w.__exports = 0;
      const real = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (key.startsWith("diagrams.doc.v1:") && /\bgetOriginal\b/.test(new Error().stack ?? "")) w.__exports++;
        return real.call(this, key);
      };
    });
    const exports = () => page.evaluate(() => (window as unknown as { __exports: number }).__exports);
    await openShareChooser(page);
    await expect(page.getByTestId("share-option-html")).toBeFocused();
    expect(await exports()).toBe(0);
    // Picking a row exports the diagram as it is now.
    await page.getByTestId("share-option-html").click();
    await expect(page.getByTestId("html-export-dialog")).toBeVisible();
    expect(await exports()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    expectNoErrors(consoleErrors);
  },
);

test("Share… stays with its diagram: another one opening closes it, loaded or still downloading", async ({
  page,
  consoleErrors,
}) => {
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  // Its code still downloading: Back opens the first diagram, and Share… for the second never appears.
  // Install before navigation: idle preloading may start while either diagram is being imported.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let requested = false;
  await page.route(CHOOSER_CHUNK, async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  await gotoCanvas(page, SLUG);
  await importOwn(page, "First plan");
  await importOwn(page, "Second plan");
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-share").click();
  await expect(page.getByTestId("lazy-dialog-loading")).toBeVisible();
  await expect.poll(() => requested).toBe(true);
  await page.goBack();
  await expect(page.getByTestId("diagram-title")).toHaveText("First plan");
  await expect(page.getByTestId("lazy-dialog")).toHaveCount(0);
  const downloaded = page.waitForResponse((r) => CHOOSER_CHUNK.test(r.url()));
  release();
  await (await downloaded).finished();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  await page.unroute(CHOOSER_CHUNK);

  // Loaded and open: Forward opens the second diagram, and Share… (for the first) closes.
  await openShareChooser(page);
  await page.goForward();
  await expect(page.getByTestId("diagram-title")).toHaveText("Second plan");
  await expect(page.getByTestId("share-chooser")).toHaveCount(0);
  // Nothing acted on either diagram meanwhile.
  await expect(page.getByTestId("html-export-dialog")).toHaveCount(0);
  expect(downloads).toEqual([]);
  expectNoErrors(consoleErrors);
});

test("a public embed closes when the diagram turns private in another tab: it never becomes the private kind", async ({
  page,
  context,
  consoleErrors,
}) => {
  test.slow(); // Two cold page loads, each with a lazy canvas and dialogs.
  await gotoCanvas(page, SLUG);
  const slug = await importOwn(page, "Public embed plan");
  await openShareChooser(page);
  await page.getByTestId("share-public-toggle").click();
  await page.getByTestId("share-option-embed-public").click();
  await expect(page.getByTestId("embed-inline-note")).toBeVisible();

  const other = await context.newPage();
  await gotoCanvas(other, slug);
  await expect(other.getByTestId("diagram-title")).toHaveText("Public embed plan");
  await makePrivate(other);
  await other.close();

  // Closed, saying why, with the safe way out: no host-supplied embed in its place.
  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);
  await expect(page.getByTestId("toast-private-export")).toBeVisible();
  expectNoErrors(consoleErrors);
});

test("an embed supplied by your app stays open when another tab makes the diagram private", async ({
  page,
  context,
  consoleErrors,
}) => {
  test.slow(); // Two cold page loads, each with a lazy canvas and dialogs.
  await gotoCanvas(page, SLUG);
  const slug = await importOwn(page, "Host-supplied embed plan");

  // Embed in your app, open when it turns private, stays as it is: the private kind, saying so.
  await openShareChooser(page);
  await page.getByTestId("share-option-embed").click();
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  const third = await context.newPage();
  await gotoCanvas(third, slug);
  await makePrivate(third);
  await third.close();
  await expect(page.getByTestId("embed-dialog")).toContainText("A private diagram embeds only where your own app");
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
