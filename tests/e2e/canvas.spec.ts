import { openExample } from "./fixtures";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoLab, publicExamples, expectNoErrors } from "./fixtures";
import type { DiagramFile } from "../../src/model/types";
import { exportFixture } from "../../src/lab/exportFixture";

// File export documents integer geometry and explicit default edge kinds / group tones.
function normalized(diagram: DiagramFile): DiagramFile {
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => ({ ...n, x: Math.round(n.x), y: Math.round(n.y) })),
    edges: diagram.edges.map((e) => ({ ...e, kind: e.kind ?? "async" })),
    ...(diagram.groups?.length
      ? {
          groups: diagram.groups.map((g) => ({
            ...g,
            tone: g.tone ?? "neutral",
            x: Math.round(g.x),
            y: Math.round(g.y),
            width: Math.round(g.width),
            height: Math.round(g.height),
          })),
        }
      : {}),
  };
}

/** File ▸ More formats ▸ Diagram file. */
async function exportJson(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-more-formats").click();
  await page.getByTestId("export-json").click();
  // The lazy completion message follows the download; finish it before importing.
  await expect(page.getByTestId("toast")).toContainText("Exported");
}

test.describe("canvas", () => {
  for (const ex of publicExamples) {
    test(`renders every node of ${ex.slug}`, async ({ page, consoleErrors }) => {
      await gotoCanvas(page, ex.slug);
      await expect(page.getByTestId("diagram-title")).toHaveText(ex.title);
      for (const id of ex.nodeIds) await expect(page.getByTestId(`node-${id}`)).toBeVisible();
      for (const id of ex.edgeIds) await expect(page.getByTestId(`edge-${id}`)).toBeAttached();
      expectNoErrors(consoleErrors);
    });
  }

  test("example picker switches diagrams and updates the URL", async ({ page }) => {
    const [a, b] = publicExamples;
    await gotoCanvas(page, a.slug);
    await openExample(page, b.slug);
    await expect(page.getByTestId("diagram-title")).toHaveText(b.title);
    await expect(page.getByTestId(`node-${b.nodeIds[0]}`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`example=${b.slug}`));
    await page.goBack();
    await expect(page.getByTestId("diagram-title")).toHaveText(a.title);
  });

  test("export downloads valid diagrams/v1 JSON and import round-trips it", async ({ page }, info) => {
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const [download] = await Promise.all([page.waitForEvent("download"), exportJson(page)]);
    expect(download.suggestedFilename()).toBe(`${ex.slug}.diagram.json`);
    const file = info.outputPath("exported.json");
    await download.saveAs(file);
    const json = JSON.parse(readFileSync(file, "utf8"));
    const source = JSON.parse(readFileSync(`src/examples/${ex.slug}.json`, "utf8")) as DiagramFile;
    expect(json).toEqual(normalized(source));
    expect(json.format).toBe("diagrams/v1");
    expect(json.title).toBe(ex.title);
    expect(json.nodes.map((n: { id: string }) => n.id).sort()).toEqual([...ex.nodeIds].sort());
    expect(json.edges.map((e: { id: string }) => e.id).sort()).toEqual([...ex.edgeIds].sort());
    const ids = new Set(json.nodes.map((n: { id: string }) => n.id));
    for (const e of json.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);

    await page.getByTestId("import-input").setInputFiles(file);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    // Imports land in Your diagrams as a new entry.
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    await expect(page).toHaveURL(/example=my-/);
    await expect(page.getByTestId("diagram-title")).toHaveText(ex.title);
    for (const id of ex.nodeIds) await expect(page.getByTestId(`node-${id}`)).toBeVisible();

    // The re-exported import is identical to the first export.
    const [again] = await Promise.all([page.waitForEvent("download"), exportJson(page)]);
    const file2 = info.outputPath("re-exported.json");
    await again.saveAs(file2);
    expect(JSON.parse(readFileSync(file2, "utf8"))).toEqual(json);
  });

  test("export preserves the complete diagram contract before and after import and reload", async ({ page }, info) => {
    await gotoLab(page, "export-contract");
    await page.getByTestId("lab-open-editor").click();
    await expect(page.getByTestId("node-worker")).toBeVisible();
    for (const phase of ["first", "imported", "reloaded"]) {
      const [download] = await Promise.all([page.waitForEvent("download"), exportJson(page)]);
      const file = info.outputPath(`${phase}.json`);
      await download.saveAs(file);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(normalized(exportFixture));
      // The download starts before the lazy export notification is ready. Finish that
      // operation before importing, so its late toast cannot replace the import's.
      await expect(page.getByTestId("toast")).toContainText("Exported");
      if (phase === "first") {
        const previous = await page.getByTestId("example-picker").getAttribute("data-diagram-slug");
        if (!previous) throw new Error("Expected the exported document's slug");
        await page.getByTestId("import-input").setInputFiles(file);
        await expect(page.getByTestId("example-picker")).not.toHaveAttribute("data-diagram-slug", previous);
        await expect(page.getByTestId("toast")).toContainText("Imported");
      } else if (phase === "imported") {
        await page.reload();
        await expect(page.getByTestId("node-worker")).toBeVisible();
      }
    }
  });

  test("invalid imports show a friendly error and keep the current diagram", async ({ page }) => {
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    await page
      .getByTestId("import-input")
      .setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ nope") });
    await expect(page.getByTestId("toast")).toContainText("isn't valid JSON");
    await expect(page.getByTestId("diagram-title")).toHaveText(ex.title);

    await page.getByTestId("import-input").setInputFiles({
      name: "other.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ format: "drawio", nodes: [], edges: [] })),
    });
    await expect(page.getByTestId("toast")).toContainText('Expected format "diagrams/v1"');

    await page.getByTestId("import-input").setInputFiles({
      name: "dangling.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "diagrams/v1",
          title: "x",
          nodes: [{ id: "a", stencil: "kafka.topic", label: "a", x: 0, y: 0 }],
          edges: [{ id: "e", from: "a", to: "ghost" }],
        }),
      ),
    });
    await expect(page.getByTestId("toast")).toContainText("points at a node");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", ex.slug);
  });

  test("theme toggle switches and persists", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    expect(await theme()).toBe("light");
    await page.getByTestId("theme-toggle").click();
    expect(await theme()).toBe("dark");
    await page.reload();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    expect(await theme()).toBe("dark");
    await page.getByTestId("theme-toggle").click();
    expect(await theme()).toBe("light");
  });

  test("presentation mode hides the chrome and Esc exits", async ({ page }) => {
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("topbar")).toHaveCount(0);
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page).toHaveURL(/present=1/);
    await expect(page.getByTestId(`node-${ex.nodeIds[0]}`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("topbar")).toBeVisible();
    await expect(page).not.toHaveURL(/present=1/);

    await page.getByTestId("present-toggle").click();
    await page.getByTestId("present-exit").click();
    await expect(page.getByTestId("topbar")).toBeVisible();
  });

  test("view switcher moves between gallery and canvas", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    await page.getByTestId("view-gallery").click();
    // The stencil library is a lazy chunk; a cold dev server under full parallel load can take a while.
    await expect(page.getByTestId("gallery-view")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/view=gallery/);
    await page.getByTestId("view-canvas").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
  });
});
