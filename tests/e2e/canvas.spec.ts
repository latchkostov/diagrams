import { readFileSync } from "node:fs";
import { test, expect, gotoCanvas, publicExamples, expectNoErrors } from "./fixtures";

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
    await page.getByTestId("example-picker").selectOption(b.slug);
    await expect(page.getByTestId("diagram-title")).toHaveText(b.title);
    await expect(page.getByTestId(`node-${b.nodeIds[0]}`)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`example=${b.slug}`));
    await page.goBack();
    await expect(page.getByTestId("diagram-title")).toHaveText(a.title);
  });

  test("export downloads valid diagrams/v1 JSON and import round-trips it", async ({ page }, info) => {
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-button").click()]);
    expect(download.suggestedFilename()).toBe(`${ex.slug}.json`);
    const file = info.outputPath("exported.json");
    await download.saveAs(file);
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.format).toBe("diagrams/v1");
    expect(json.title).toBe(ex.title);
    expect(json.nodes.map((n: { id: string }) => n.id).sort()).toEqual([...ex.nodeIds].sort());
    expect(json.edges.map((e: { id: string }) => e.id).sort()).toEqual([...ex.edgeIds].sort());
    const ids = new Set(json.nodes.map((n: { id: string }) => n.id));
    for (const e of json.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);

    await page.getByTestId("import-input").setInputFiles(file);
    await expect(page.getByTestId("toast")).toContainText("Imported");
    await expect(page.getByTestId("example-picker")).toHaveValue("imported");
    await expect(page).toHaveURL(/example=imported/);
    await expect(page.getByTestId("diagram-title")).toHaveText(ex.title);
    for (const id of ex.nodeIds) await expect(page.getByTestId(`node-${id}`)).toBeVisible();

    // The re-exported import is identical to the first export.
    const [again] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-button").click()]);
    const file2 = info.outputPath("re-exported.json");
    await again.saveAs(file2);
    expect(JSON.parse(readFileSync(file2, "utf8"))).toEqual(json);
  });

  test("invalid imports show a friendly error and keep the current diagram", async ({ page }) => {
    const ex = publicExamples[0];
    await gotoCanvas(page, ex.slug);
    await page.getByTestId("import-input").setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ nope") });
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
        JSON.stringify({ format: "diagrams/v1", title: "x", nodes: [{ id: "a", stencil: "kafka.topic", label: "a", x: 0, y: 0 }], edges: [{ id: "e", from: "a", to: "ghost" }] }),
      ),
    });
    await expect(page.getByTestId("toast")).toContainText("points at a node");
    await expect(page.getByTestId("example-picker")).toHaveValue(ex.slug);
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
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    await expect(page).toHaveURL(/view=gallery/);
    await page.getByTestId("view-canvas").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
  });
});
