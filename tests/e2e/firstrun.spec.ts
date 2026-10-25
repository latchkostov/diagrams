import { chunk, holdChunk, releaseAndEvaluate } from "./chunk";
import { waitForStableViewport } from "./fixtures";
import { currentDiagram } from "./fixtures";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples, publicExampleCards, expectNoErrors } from "./fixtures";

// First run and starting a diagram: the bare URL opens a blank canvas with the start card, the
// card's ways in, File > New diagram (nothing is replaced), the one-time hint and the node tooltip.

/** A small native file with extension metadata the canvas doesn't model (top level and per node). */
const WORK = JSON.stringify({
  format: "diagrams/v1",
  title: "My order flow",
  "x-owner": "platform-team",
  nodes: [
    {
      id: "api",
      stencil: "service.go",
      label: "Orders API",
      x: 40,
      y: 40,
      props: { replicas: 3 },
      "x-runbook": "https://runbooks.example/api",
    },
    { id: "topic", stencil: "kafka.topic", label: "orders", x: 420, y: 40, props: { partitions: 6 } },
  ],
  edges: [{ id: "api-topic", from: "api", to: "topic", label: "OrderPlaced" }],
});

async function pasteDiagram(page: Page, text: string) {
  await page.getByTestId("start-paste").click();
  await page.getByTestId("paste-input").fill(text);
  await page.getByTestId("paste-submit").click();
  await expect(page.getByTestId("paste-dialog")).toHaveCount(0);
  await expect(page.getByTestId("node-api")).toBeVisible();
}

/** File ▸ More formats ▸ Diagram file, parsed. */
async function exportedJson(page: Page, path: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-more-formats").click();
      await page.getByTestId("export-json").click();
    })(),
  ]);
  await download.saveAs(path);
  return JSON.parse(readFileSync(path, "utf8"));
}

test.describe("first run", () => {
  test("a bare URL opens a blank diagram with the start card", async ({ page, consoleErrors }) => {
    await page.goto("./");
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    // A blank draft: nothing is kept until the first edit.
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "new");
    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    // A few featured examples first; "All examples" opens the rest, grouped by theme.
    await page.getByTestId("start-all-examples").click();
    for (const ex of publicExamples) {
      await expect(page.getByTestId(`example-card-${ex.slug}`)).toBeVisible();
      // A thumbnail draws at most its first 48 nodes (MAX_NODES in src/lib/thumbnail.ts).
      await expect(page.getByTestId(`example-thumb-${ex.slug}`)).toHaveAttribute(
        "data-nodes",
        String(Math.min(ex.nodeIds.length, 48)),
      );
    }
    await expect(publicExampleCards(page)).toHaveCount(publicExamples.length);
    await page.getByTestId(`example-open-${publicExamples[0].slug}`).click();
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", publicExamples[0].slug);
    await expect(page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Start blank opens the stencil search; adding a node retires the card", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    await expect(page.getByTestId("palette-search")).toBeFocused();
    await expect(page.getByTestId("palette-search")).toBeFocused();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("canvas-empty")).toHaveCount(0);
    await expect(page.getByTestId("live-toggle")).toBeVisible();
  });

  test("the start card's import buttons open the file and paste flows", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-paste").click();
    await expect(page.getByTestId("paste-dialog")).toBeVisible();
  });

  test("the first edit keeps a blank diagram in Your diagrams, without remounting the canvas", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await page.getByTestId("canvas-view").evaluate((el) => el.setAttribute("data-test-instance", "kept"));
    await expect(page.getByTestId("palette-search")).toBeFocused();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    await expect(page).toHaveURL(/example=my-/);
    await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-test-instance", "kept");
    // Undo history survived too: the add can be undone.
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("live-toggle")).toHaveCount(0);
  });

  test("File > New diagram starts a blank one and keeps the previous in Your diagrams", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("palette-search")).toBeFocused();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    // The first edit kept it in Your diagrams.
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    const first = await currentDiagram(page);

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "new");
    // Nothing was replaced: the previous diagram is listed first on the start card.
    await expect(page.getByTestId(`start-recent-${first}`)).toBeVisible();
    await expect(page.getByTestId(`start-recent-${first}-thumb`)).toHaveAttribute("data-nodes", "1");
    await page.getByTestId(`start-recent-${first}`).click();
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", first);
  });

  test("New diagram keeps unsaved content, extension metadata included, across reload", async ({ page }, info) => {
    await page.goto("./");
    await pasteDiagram(page, WORK);
    // An unsaved edit on top of the imported file.
    await page.getByTestId("node-api").click();
    await page.getByTestId("inspector-field-label").fill("Orders API v2");
    await expect(page.getByTestId("node-api")).toContainText("Orders API v2");
    const before = await exportedJson(page, info.outputPath("before.json"));
    expect(before["x-owner"]).toBe("platform-team");
    expect(before.nodes.find((n: { id: string }) => n.id === "api")).toMatchObject({
      label: "Orders API v2",
      props: { replicas: 3 },
      "x-runbook": "https://runbooks.example/api",
    });

    const mine = await currentDiagram(page);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    await page.getByTestId(`start-recent-${mine}`).click();
    await expect(page.getByTestId("node-api")).toContainText("Orders API v2");
    await expect(page.getByTestId("node-topic")).toBeVisible();
    await expect(page.getByTestId("edge-api-topic")).toBeAttached();
    expect(await exportedJson(page, info.outputPath("restored.json"))).toEqual(before);

    await page.reload();
    await expect(page.getByTestId("node-api")).toContainText("Orders API v2");
    expect(await exportedJson(page, info.outputPath("reloaded.json"))).toEqual(before);
  });

  test("New diagram from an open example: your saved work is one click away", async ({ page }) => {
    await page.goto("./");
    await pasteDiagram(page, WORK);
    await expect(page.getByTestId("node-api")).toBeVisible();
    const mine = await currentDiagram(page);
    await gotoCanvas(page, publicExamples[0].slug);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", "new");
    await expect(page.getByTestId("start-card")).toBeVisible();
    await page.getByTestId(`start-recent-${mine}`).click();
    await expect(page.getByTestId("node-api")).toBeVisible();
    await expect(page.getByTestId("node-topic")).toBeVisible();
    await expect(page.getByTestId("edge-api-topic")).toBeAttached();
  });

  test("the one-time hint retires on dismiss and stays gone", async ({ page }) => {
    await gotoCanvas(page, publicExamples[0].slug);
    const hint = page.getByTestId("first-run-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toContainText("saved simulation");
    await page.getByTestId("first-run-hint-dismiss").click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(hint).toHaveCount(0);
  });

  test("nodes show the app tooltip, not a native title", async ({ page }) => {
    const ex = publicExamples.find((e) => e.slug === "kafka-order-pipeline") ?? publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const node = page.getByTestId(`node-${ex.nodeIds[0]}`);
    expect(await node.evaluate((el) => el.querySelectorAll("[title]").length)).toBe(0);
    await node.hover();
    await expect(page.getByTestId("node-tooltip")).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("node-tooltip")).toHaveCount(0);
  });

  test("showing and hiding the node tooltip doesn't re-render the diagram's nodes @dev", async ({ page }) => {
    // A minimal React DevTools hook that counts DiagramNode renders per commit (dev build only: @dev).
    await page.addInitScript(() => {
      type Fiber = {
        type?: { name?: string; displayName?: string; type?: { name?: string } } | string | null;
        flags: number;
        actualStartTime?: number;
        child: Fiber | null;
        sibling: Fiber | null;
      };
      const w = window as unknown as { __nodeRenders: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
      const seen = new WeakMap<Fiber, number | undefined>();
      w.__nodeRenders = 0;
      const nameOf = (f: Fiber) =>
        f.type && typeof f.type === "object"
          ? (f.type.displayName ?? f.type.name ?? f.type.type?.name)
          : typeof f.type === "function"
            ? (f.type as { name?: string }).name
            : undefined;
      const walk = (start: Fiber | null) => {
        for (let f = start; f; f = f.sibling) {
          // PerformedWork (1) with a fresh start time: this fiber rendered in this commit.
          if (nameOf(f) === "DiagramNodeImpl" && f.flags & 1 && seen.get(f) !== f.actualStartTime) {
            seen.set(f, f.actualStartTime);
            w.__nodeRenders++;
          }
          walk(f.child);
        }
      };
      w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map(),
        supportsFiber: true,
        inject: () => 1,
        onScheduleFiberRoot() {},
        onCommitFiberRoot: (_id: number, root: { current: Fiber }) => walk(root.current),
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
      };
    });
    const ex = publicExamples.find((e) => e.slug === "kafka-order-pipeline") ?? publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const renders = () => page.evaluate(() => (window as unknown as { __nodeRenders: number }).__nodeRenders);
    expect(await renders()).toBeGreaterThan(0);
    // Let the first fit, measurement and hint settle: no node renders for a whole second.
    let last = -1;
    await expect
      .poll(
        async () => {
          const now = await renders();
          const settled = now === last;
          last = now;
          return settled;
        },
        { intervals: [1000], timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(() => ((window as unknown as { __nodeRenders: number }).__nodeRenders = 0));
    await page.getByTestId(`node-${ex.nodeIds[0]}`).hover();
    await expect(page.getByTestId("node-tooltip")).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.getByTestId("node-tooltip")).toHaveCount(0);
    // The regression re-rendered every node on show and on hide (30 renders for 15 nodes). A late
    // font or measurement update on a busy machine may still touch a node or two.
    expect(await renders()).toBeLessThan(ex.nodeIds.length / 2);
  });

  test("keyboard focus shows the node tooltip and describes the node; Esc dismisses it", async ({ page }) => {
    const ex = publicExamples.find((e) => e.slug === "kafka-order-pipeline") ?? publicExamples[0];
    await gotoCanvas(page, ex.slug);
    const node = page.getByTestId(`node-${ex.nodeIds[0]}`);
    // React Flow's focusable wrapper is the node card's parent.
    await node.evaluate((el) => (el.closest("[tabindex]") as HTMLElement).focus());
    const tip = page.getByTestId("node-tooltip");
    await expect(tip).toBeVisible();
    const tipId = (await tip.getAttribute("id")) ?? "";
    expect(tipId).not.toBe("");
    const describedBy = () => node.evaluate((el) => el.closest("[tabindex]")?.getAttribute("aria-describedby") ?? "");
    expect(await describedBy()).toContain(tipId);
    await page.keyboard.press("Escape");
    await expect(tip).toHaveCount(0);
    expect(await describedBy()).not.toContain(tipId);
  });
});

for (const locale of ["en", "ar"]) {
  test(`held discovery keeps start row geometry, keyboard and focus in ${locale}`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    const pattern = chunk("ExampleDetails", "src/examples/ExampleDetails.tsx");
    const held = await holdChunk(page, pattern);
    try {
      await page.goto("./");
      await expect.poll(held.requested).toBe(true);
      const row = page.getByTestId("start-example-black-friday-commerce");
      await expect(row).toBeVisible();
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).direction)).toBe(
        locale === "ar" ? "rtl" : "ltr",
      );
      await expect(page.getByTestId("start-example-black-friday-commerce-thumb")).toHaveCount(0);
      expect(await row.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
      await waitForStableViewport(page);
      await page.evaluate(() => document.fonts.ready);
      await page
        .getByTestId("start-card")
        .evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
      const box = await row.boundingBox();
      await row.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(row).toBeFocused();
      await releaseAndEvaluate(page, pattern, held.release);
      await expect(page.getByTestId("start-example-black-friday-commerce-thumb")).toBeVisible();
      expect(await row.boundingBox()).toEqual(box);
      await expect(row).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("diagram-title")).toHaveText("Black Friday commerce platform");
    } finally {
      held.release();
    }
  });
}

test("held discovery does not reopen a dismissed start card or steal placement focus", async ({ page }) => {
  const pattern = chunk("ExampleDetails", "src/examples/ExampleDetails.tsx");
  const held = await holdChunk(page, pattern);
  try {
    await page.goto("./");
    await expect.poll(held.requested).toBe(true);
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("palette-search")).toBeFocused();
    await releaseAndEvaluate(page, pattern, held.release);
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    await expect(page.getByTestId("palette-search")).toBeFocused();
  } finally {
    held.release();
  }
});

test("start Open and recent diagrams work while discovery is held", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "showOpenFilePicker", { configurable: true, value: undefined }),
  );
  const held = await holdChunk(page, chunk("ExampleDetails", "src/examples/ExampleDetails.tsx"));
  try {
    await page.goto("./");
    await expect.poll(held.requested).toBe(true);
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("start-open").click();
    await (
      await chooser
    ).setFiles({ name: "flow.diagram.json", mimeType: "application/json", buffer: Buffer.from(WORK) });
    await expect(page.getByTestId("node-api")).toBeVisible();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    const recent = page.getByTestId(/^start-recent-my-[^-]+$/).first();
    await recent.click();
    await expect(page.getByTestId("node-api")).toBeVisible();
  } finally {
    held.release();
  }
});
