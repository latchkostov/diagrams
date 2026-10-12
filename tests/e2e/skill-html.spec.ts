import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect, gotoCanvas } from "./fixtures";
import { expectPlaying, filePayload, KAFKA, watchedPage } from "./html-viewer";

// The agent skill's offline Interactive HTML export (skills/livediagrams/scripts/export-html.mjs): it writes the
// app's own file, byte for byte, from the viewer template and icons bundled in the skill; the file opens from
// disk, renders and plays with zero requests; and a private diagram gets a file but never a share link.
// Selectors are data-testid only.

const SCRIPTS = join(process.cwd(), "skills", "livediagrams", "scripts");
const BANNER = "Confidential: internal use only";

function run(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Runs export-html.mjs into this test's output folder; returns the file's path and text. */
function exportHtml(diagramFile: string, ...args: string[]) {
  const dir = test.info().outputPath("skill");
  const r = run("export-html.mjs", diagramFile, "--out", dir, ...args);
  expect(r.code, r.err).toBe(0);
  const path = r.out.split("\n")[0].replace(/ \(.*$/, "");
  return { path, html: readFileSync(path, "utf8"), out: r.out };
}

test.describe("The agent skill's Interactive HTML export", () => {
  test("writes the app's own file, byte for byte", async ({ page }) => {
    test.setTimeout(60_000);
    await gotoCanvas(page, KAFKA);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-html").click();
    await page.getByTestId("html-export-options-toggle").click();
    await page.getByTestId("html-export-banner").fill(BANNER);
    await page.getByTestId("html-export-theme-dark").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("html-export-download").click(),
    ]);
    const appPath = test.info().outputPath("app", download.suggestedFilename());
    await download.saveAs(appPath);
    const app = readFileSync(appPath, "utf8");

    // The same diagram as the app had it, and the same options (and day), through the skill.
    const { diagram, options } = filePayload(app);
    const file = test.info().outputPath("kafka.diagram.json");
    writeFileSync(file, JSON.stringify(diagram, null, 2));
    const skill = exportHtml(file, "--banner", BANNER, "--theme", "dark", "--exported-on", options.exportedOn);
    expect(skill.path.endsWith(download.suggestedFilename())).toBe(true);
    expect(skill.html.length).toBe(app.length);
    expect(skill.html === app, "the skill's file differs from the app's").toBe(true);
  });

  test("opens from disk, renders and plays, with zero requests", async ({ context }) => {
    test.setTimeout(90_000);
    const { path, out } = exportHtml(join(process.cwd(), "src", "examples", `${KAFKA}.json`), "--banner", BANNER);
    expect(out).toMatch(/plays "Black Friday/);
    expect(out).toMatch(/no network requests/);

    const url = pathToFileURL(path).href;
    const viewer = await watchedPage(context);
    await viewer.page.goto(url);
    await expectPlaying(viewer.page);
    await expect(viewer.page.getByTestId("viewer-banner")).toHaveText(BANNER);
    await expect(viewer.page.getByTestId("viewer-footer")).toContainText("Exported from Live Diagrams on");
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([url]);
    expect(await viewer.page.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });

  test("a private diagram gets an HTML file, never a share link", async ({ context }) => {
    const file = test.info().outputPath("ledger.diagram.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "diagrams/v1",
        title: "Ledger flow",
        private: true,
        nodes: [
          { id: "intake", stencil: "service.node", label: "Intake service", x: 0, y: 0 },
          { id: "ledger", stencil: "postgres", label: "Ledger", x: 360, y: 0 },
        ],
        edges: [{ id: "e1", from: "intake", to: "ledger", kind: "sync" }],
      }),
    );
    const link = run("share-link.mjs", file);
    expect(link.code).toBe(1);
    expect(link.out).toBe("");
    expect(link.err).toMatch(/private diagram/);

    const { path, html } = exportHtml(file, "--no-autoplay");
    expect(path.endsWith("Ledger flow.html")).toBe(true);
    expect(filePayload(html).diagram.private).toBe(true);
    const url = pathToFileURL(path).href;
    const viewer = await watchedPage(context);
    await viewer.page.goto(url);
    await expect(viewer.page.getByTestId("html-viewer")).toBeVisible();
    await expect(viewer.page.getByTestId("node-intake")).toBeVisible();
    await expect(viewer.page.getByTestId("node-ledger")).toBeVisible();
    expect(viewer.requests.filter((r) => !r.startsWith("data:"))).toEqual([url]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });
});
