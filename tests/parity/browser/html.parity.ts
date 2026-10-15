// Interactive HTML export (File ▸ More formats ▸ Interactive HTML…): the file the production app downloads, byte for
// byte after normalising what is nondeterministic or build output, and what it draws when opened from file://.
// - The export date (`exportedOn`, today) is fixed, in the golden and in the file the viewer opens.
// - The viewer's inline script and style are build output (a refactor changes them by design), and so are their
//   hashes in the Content-Security-Policy: both are replaced by placeholders. The page around them is pinned.
// - The payload (the diagram, its icons and the options) is pinned as data, its icons by hash.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expectGolden, expectGoldenText } from "../lib/golden";
import { fingerprint } from "../lib/hash";
import { openExample, settledCanvas } from "./canvas";
import { expectGoldenPng } from "./png";

const EXAMPLES = ["kafka-order-pipeline", "branch-to-datacentre"];

async function exportHtml(page: Page, options?: { theme: "dark"; banner: string }): Promise<string> {
  const template = page.waitForResponse((r) =>
    /\/export\/interactive-viewer(?:-[a-f0-9]+)?\.html$/.test(new URL(r.url()).pathname),
  );
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await expect(page.getByTestId("file-more-formats-menu")).toBeVisible();
  await page.getByTestId("export-html").click();
  await expect(page.getByTestId("html-export-dialog")).toBeVisible();
  expect((await template).ok()).toBe(true);
  if (options) {
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId(`html-export-theme-${options.theme}`).click();
    await page.getByTestId("html-export-banner").fill(options.banner);
    // Opens on the diagram, not playing, so what it draws settles.
    await page.getByTestId("html-export-start").selectOption("");
  }
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("html-export-download").click(),
  ]);
  return readFileSync(await download.path(), "utf8");
}

const PAYLOAD = /(<script type="application\/json" id="diagram">)([\s\S]*?)(<\/script>)/;
const EXPORTED_ON = /("exportedOn":")(\d{4}-\d{2}-\d{2})(")/;
const FIXED_DATE = "2026-01-01";

/** The file with a fixed export date (the footer shows it): one place, checked, for the golden and the viewer. */
function withFixedDate(html: string): string {
  if (!EXPORTED_ON.test(html)) throw new Error("the exported file has no exportedOn date");
  const fixed = html.replace(EXPORTED_ON, `$1${FIXED_DATE}$3`);
  if (EXPORTED_ON.exec(fixed)?.[2] !== FIXED_DATE) throw new Error("the export date wasn't replaced");
  return fixed;
}

function normalise(exported: string) {
  const html = withFixedDate(exported);
  const payloadText = PAYLOAD.exec(html)?.[2];
  if (!payloadText) throw new Error("no payload in the exported file");
  const payload = JSON.parse(payloadText) as { icons: Record<string, string>; options: { exportedOn: string } };
  const shell = html
    .replace(PAYLOAD, "$1«payload: see the .json beside»$3")
    .replace(/<script>[\s\S]*?<\/script>/g, "<script>«viewer script»</script>")
    .replace(/<style>[\s\S]*?<\/style>/g, "<style>«viewer style»</style>")
    .replace(/'sha256-[A-Za-z0-9+/=]+'/g, "'sha256-«hash»'");
  return {
    shell,
    payload: {
      ...payload,
      icons: Object.fromEntries(Object.entries(payload.icons).map(([k, v]) => [k, fingerprint(v)])),
    },
  };
}

for (const slug of EXAMPLES) {
  test(`interactive HTML: ${slug} (defaults)`, async ({ page }) => {
    await openExample(page, slug);
    const { shell, payload } = normalise(await exportHtml(page));
    expectGoldenText(`html/${slug}.default.html`, shell);
    expectGolden(`html/${slug}.default.json`, payload);
  });

  test(`interactive HTML: ${slug} (dark, banner, not playing) and what it draws`, async ({ page, context }, info) => {
    await openExample(page, slug);
    const html = await exportHtml(page, { theme: "dark", banner: "Confidential: internal use only" });
    const { shell, payload } = normalise(html);
    expectGoldenText(`html/${slug}.dark.html`, shell);
    expectGolden(`html/${slug}.dark.json`, payload);
    // Opened with a fixed export date (its footer shows it), so what it draws doesn't change with the day.
    const file = info.outputPath(`${slug}.html`);
    writeFileSync(file, withFixedDate(html));
    const viewer = await context.newPage();
    await viewer.goto(pathToFileURL(file).href);
    await expect(viewer.getByTestId("html-viewer")).toBeVisible();
    expectGolden(`html/${slug}.dark.drawn.json`, await settledCanvas(viewer));
    // How it looks, banner and footer included: the viewer's own CSS isn't in the file's golden (it's build output).
    await expectGoldenPng(page, `html/${slug}.dark.png`, await viewer.screenshot({ fullPage: true }));
    await viewer.close();
  });
}
