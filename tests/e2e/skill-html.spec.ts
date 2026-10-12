import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { test, expect, gotoCanvas, E2E_TARGET } from "./fixtures";
import { expectPlaying, filePayload, KAFKA, watchedPage } from "./html-viewer";

// The agent skill's offline Interactive HTML export (skills/livediagrams/scripts/export-html.mjs): it carries what
// the app's file carries, from the viewer and icons released in the skill; the file opens from disk, renders and
// plays with zero requests; a private diagram gets a file but never a share link; and the site's /skill/ download
// carries the current viewer, and the downloaded skill works on its own. Selectors are data-testid only.

const SCRIPTS = join(process.cwd(), "skills", "livediagrams", "scripts");
const BANNER = "Confidential: internal use only";

function run(script: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Every entry of a zip (local headers, DEFLATE): name → bytes. */
function zipEntries(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const start = at + 30 + nameLength + zip.readUInt16LE(at + 28);
    out.set(
      zip.subarray(at + 30, at + 30 + nameLength).toString("utf8"),
      inflateRawSync(zip.subarray(start, start + size)),
    );
    at = start + size;
  }
  return out;
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
  test("carries the diagram and options the app's file does", async ({ page }) => {
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

    // The same diagram as the app had it, and the same options (and day), through the skill. The viewer itself
    // is the skill's released copy, which may be older than the app's (`pnpm skill:check`), so only the payload's
    // diagram and options, the file name, the title and the theme are compared.
    const { diagram, options } = filePayload(app);
    const file = test.info().outputPath("kafka.diagram.json");
    writeFileSync(file, JSON.stringify(diagram, null, 2));
    const skill = exportHtml(file, "--banner", BANNER, "--theme", "dark", "--exported-on", options.exportedOn);
    expect(skill.path.endsWith(download.suggestedFilename())).toBe(true);
    expect(filePayload(skill.html).diagram).toEqual(diagram);
    expect(filePayload(skill.html).options).toEqual(options);
    const head = (html: string) =>
      html.slice(0, html.indexOf("<meta http-equiv")) + /<title>.*<\/title>/.exec(html)?.[0];
    expect(head(skill.html)).toBe(head(app));
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

  test("the site's /skill/ folder and zip carry this build's viewer", async ({ page }) => {
    test.skip(E2E_TARGET !== "build", "the dev server builds the template under another name");
    const res = await page.request.get("/skill/scripts/lib/viewer-template.html");
    expect(res.status()).toBe(200);
    const template = await res.text();
    // The app's own template is emitted as export/interactive-viewer-<its sha256>.html.
    const hash = createHash("sha256").update(template).digest("hex").slice(0, 10);
    const app = await page.request.get(`/export/interactive-viewer-${hash}.html`);
    expect(app.status(), "the skill's template isn't this build's").toBe(200);
    expect((await app.text()) === template).toBe(true);
    // The zip's copy too.
    const zip = await (await page.request.get("/livediagrams-skill.zip")).body();
    expect(zipEntries(zip).get("livediagrams/scripts/lib/viewer-template.html")?.toString("utf8") === template).toBe(
      true,
    );
  });

  test("the downloaded skill exports a file that plays offline", async ({ page, context }) => {
    test.setTimeout(90_000);
    // The zip people download, unpacked into a folder of its own, outside the repository.
    const zip = await (await page.request.get("/livediagrams-skill.zip")).body();
    const dir = test.info().outputPath("downloaded");
    for (const [name, data] of zipEntries(zip)) {
      expect(name, "every entry sits in livediagrams/, with no way out of it").toMatch(
        /^livediagrams\/(?!.*\.\.)[\w./-]+$/,
      );
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), data);
    }
    const diagram = join(dir, "work", "orders.diagram.json");
    mkdirSync(dirname(diagram), { recursive: true });
    writeFileSync(diagram, readFileSync(join(process.cwd(), "src", "examples", `${KAFKA}.json`)));

    // Plain Node, run from the unpacked folder: nothing of the repository on its path.
    const r = spawnSync(
      process.execPath,
      [join("livediagrams", "scripts", "export-html.mjs"), diagram, "--banner", BANNER, "--out", join(dir, "out")],
      { cwd: dir, encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(0);
    const path = r.stdout.split("\n")[0].replace(/ \(.*$/, "");
    expect(path.startsWith(join(dir, "out"))).toBe(true);

    const url = pathToFileURL(path).href;
    const viewer = await watchedPage(context);
    await viewer.page.goto(url);
    // Every node with its icon loaded, the simulations play and switch.
    await expectPlaying(viewer.page);
    await expect(viewer.page.getByTestId("viewer-banner")).toHaveText(BANNER);
    expect(viewer.requests.filter((u) => !u.startsWith("data:"))).toEqual([url]);
    expect(await viewer.page.evaluate(() => window.__violations ?? [])).toEqual([]);
    expect(viewer.errors).toEqual([]);
    await viewer.page.close();
  });
});
