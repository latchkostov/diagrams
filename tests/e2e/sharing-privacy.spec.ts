import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, expectNoErrors } from "./fixtures";

// Sharing, export, embed and privacy, reviewed together (docs/DESIGN-REVIEW.md, round 21): every way out says who
// can open what it makes, a private diagram's off rows say why from the keyboard too, and Esc always closes.
// Every diagram here is public or synthetic.

const SLUG = "kafka-order-pipeline";
const PRIVATE_SHARE = "Private diagrams can't be shared as links. Export Interactive HTML instead.";

/** An edited diagram of your own (not a pristine example), so Embed code… opens on "In the link". */
async function importDiagram(page: Page, title: string) {
  await page.getByTestId("import-input").setInputFiles({
    name: "plan.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "diagrams/v1",
        title,
        nodes: [
          { id: "intake", stencil: "generic.service", label: "Intake service", x: 0, y: 0 },
          { id: "ledger", stencil: "postgres", label: "Ledger", x: 320, y: 0 },
        ],
        edges: [{ id: "intake-to-ledger", from: "intake", to: "ledger" }],
      }),
    ),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText(title);
}

/** File ▸ Privacy ▸ Private diagram. */
async function makePrivate(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("private-badge")).toBeVisible();
}

test("the File menu says who can open each link, and so does the toast", async ({ page, context, consoleErrors }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoCanvas(page, SLUG);
  await page.getByTestId("file-button").click();
  await expect(page.getByTestId("export-share-link")).toContainText("Anyone with the link can open it");
  await expect(page.getByTestId("export-share-link-password")).toContainText(
    "Only people with the password can open it",
  );
  await page.getByTestId("export-share-link").click();
  const details = page.getByTestId("toast-share-details");
  const dialog = page.getByTestId("share-link-dialog");
  await expect(details.or(dialog)).toBeVisible();
  if (await details.isVisible()) {
    await expect(page.getByTestId("toast").last()).toContainText("Anyone with the link can open the diagram.");
    await details.click();
  }
  // Opened while the link is still being made, the dialog holds focus itself, then hands it to Copy link: Esc
  // closes it either way.
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("share-link-copy")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("a private diagram's off link rows are reachable from the keyboard and say why", async ({
  page,
  consoleErrors,
}) => {
  await gotoCanvas(page, SLUG);
  await makePrivate(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("file-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toBeVisible();
  const link = page.getByTestId("export-share-link");
  for (let i = 0; i < 12; i++) {
    if (await link.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-disabled", "true");
  await expect(link).toContainText(PRIVATE_SHARE);
  // Off: Enter does nothing, and no link is made.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toBeVisible();
  await expect(page.getByTestId("share-link-dialog")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("export-share-link-password")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("export-embed")).toBeFocused();
  await expect(page.getByTestId("export-embed")).toContainText("Your app supplies it (private)");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("file-menu")).toHaveCount(0);
  await expect(page.getByTestId("file-button")).toBeFocused();

  // The Privacy submenu and the dialog name the way to share it.
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await expect(page.getByTestId("file-privacy-menu")).toContainText("export Interactive HTML");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByTestId("private-badge").click();
  await expect(page.getByTestId("privacy-dialog")).toContainText("export Interactive HTML");
  await expect(page.getByTestId("privacy-dialog-list")).toContainText("embeds only where your own app supplies it");
  await page.keyboard.press("Escape");
  expectNoErrors(consoleErrors);
});

test("Embed code: In the link says who can open it, and the preview is not a Tab stop", async ({
  page,
  consoleErrors,
}) => {
  await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await importDiagram(page, "Settlement plan");
  await page.getByTestId("file-button").click();
  await page.getByTestId("export-embed").click();
  const dialog = page.getByTestId("embed-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("embed-source-inline")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("embed-inline-note")).toContainText(
    "Anyone who can see the page can open this diagram.",
  );
  await expect(page.getByTestId("embed-preview")).toHaveAttribute("tabindex", "-1");
  await expect(page.getByTestId("embed-copy")).toBeFocused();

  // Your app supplies it: the note gives way to the private promise.
  await page.getByTestId("embed-source-host").click();
  await expect(page.getByTestId("embed-inline-note")).toHaveCount(0);
  await expect(page.getByTestId("embed-host-note")).toBeVisible();
  await expect(page.getByTestId("embed-preview")).toHaveAttribute("tabindex", "-1");

  // Tab from the snippet goes past the preview to Options, inside the dialog, and Esc still closes it.
  await page.getByTestId("embed-snippet").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("embed-options-toggle")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expectNoErrors(consoleErrors);
});
