import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, publicExamples, expectNoErrors } from "./fixtures";

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
    await expect(page.getByTestId("example-picker")).toHaveValue("new");
    const card = page.getByTestId("start-card");
    await expect(card).toBeVisible();
    // A few featured examples first; "All examples" opens the rest, grouped by theme.
    await page.getByTestId("start-all-examples").click();
    // Only public examples are offered, each with a rendered thumbnail of its nodes.
    for (const ex of publicExamples) {
      await expect(page.getByTestId(`start-example-${ex.slug}`)).toBeVisible();
      await expect(page.getByTestId(`start-example-${ex.slug}-thumb`)).toHaveAttribute(
        "data-nodes",
        String(ex.nodeIds.length),
      );
    }
    await expect(page.getByTestId(/^start-example-.*(?<!-thumb)$/)).toHaveCount(publicExamples.length);
    // Nobody has diagrams of their own yet.
    await expect(page.getByTestId(/^start-recent-/)).toHaveCount(0);
    // Nothing to simulate yet: no Live toggle, no minimap.
    await expect(page.getByTestId("live-toggle")).toHaveCount(0);
    await expect(page.getByTestId("canvas-minimap")).toHaveCount(0);

    await page.getByTestId(`start-example-${publicExamples[0].slug}`).click();
    await expect(page.getByTestId("example-picker")).toHaveValue(publicExamples[0].slug);
    await expect(page.getByTestId(`node-${publicExamples[0].nodeIds[0]}`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });

  test("Start blank opens the stencil search; adding a node retires the card", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await expect(page.getByTestId("start-card")).toHaveCount(0);
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
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveValue(/^my-/);
    await expect(page).toHaveURL(/example=my-/);
    await expect(page.getByTestId("canvas-view")).toHaveAttribute("data-test-instance", "kept");
    // Undo history survived too: the add can be undone.
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("live-toggle")).toHaveCount(0);
  });

  test("File > New diagram starts a blank one and keeps the previous in Your diagrams", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("start-blank").click();
    await page.keyboard.type("kafka topic");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    // The first edit kept it in Your diagrams.
    await expect(page.getByTestId("example-picker")).toHaveValue(/^my-/);
    const first = await page.getByTestId("example-picker").inputValue();

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("start-card")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveValue("new");
    // Nothing was replaced: the previous diagram is listed first on the start card.
    await expect(page.getByTestId(`start-recent-${first}`)).toBeVisible();
    await expect(page.getByTestId(`start-recent-${first}-thumb`)).toHaveAttribute("data-nodes", "1");
    await page.getByTestId(`start-recent-${first}`).click();
    await expect(page.getByTestId("start-card")).toHaveCount(0);
    await expect(page.getByTestId("live-toggle")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveValue(first);
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

    const mine = await page.getByTestId("example-picker").inputValue();
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
    const mine = await page.getByTestId("example-picker").inputValue();
    await gotoCanvas(page, publicExamples[0].slug);
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-new").click();
    await expect(page.getByTestId("example-picker")).toHaveValue("new");
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
