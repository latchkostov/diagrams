import { test, expect, gotoLab, labPresetIds, expectNoErrors, publicExamples } from "./fixtures";

/** Waits until a preset has fully rendered: diagram stages report a render time; sim stages show a readout. */
async function waitForPreset(page: import("@playwright/test").Page) {
  const stage = page.getByTestId("lab-stage");
  const kind = await stage.getAttribute("data-kind");
  await expect(page.getByTestId("lab-stage-error")).toHaveCount(0);
  if (kind === "render") return;
  await expect(page.getByTestId("lab-render-time")).toHaveAttribute("data-ms", /^\d+$/, { timeout: 15_000 });
  if (kind === "scenario") await expect(page.getByTestId("sim-readout").or(page.getByTestId("sim-unavailable"))).toBeVisible();
}

test.describe("lab", () => {
  test("every preset renders without errors", async ({ page, consoleErrors }) => {
    test.setTimeout(180_000);
    const ids = await labPresetIds(page);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      await test.step(id, async () => {
        await gotoLab(page, id);
        await waitForPreset(page);
        await expect(page.getByTestId("lab-preset-title")).not.toBeEmpty();
        expectNoErrors(consoleErrors.map((e) => `[${id}] ${e}`));
      });
    }
  });

  test("defaults to a preset and is reachable from the top bar in dev", async ({ page }) => {
    await page.goto("./?view=gallery");
    await page.getByTestId("view-lab").click();
    await expect(page.getByTestId("lab-view")).toBeVisible();
    await expect(page).toHaveURL(/view=lab/);
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", /.+/);
    await expect(page.getByTestId("view-lab")).toHaveAttribute("aria-selected", "true");
  });

  test("a 150-node stress diagram renders quickly", async ({ page }) => {
    const started = Date.now();
    await gotoLab(page, "stress-150");
    await expect(page.getByTestId("lab-render-time")).toHaveAttribute("data-ms", /^\d+$/, { timeout: 15_000 });
    const wall = Date.now() - started;
    await expect(page.getByTestId(/^node-n\d+$/)).toHaveCount(150);
    await expect(page.getByTestId("lab-diagram-stats")).toContainText("150 nodes");
    const ms = Number(await page.getByTestId("lab-render-time").getAttribute("data-ms"));
    test.info().annotations.push({ type: "perf", description: `stress-150: stage ${ms} ms, wall ${wall} ms` });
    expect(ms).toBeLessThan(5000);
  });

  test("URL controls apply, and editing a control updates the URL", async ({ page }) => {
    await gotoLab(page, "stress-10", { nodes: 25, groups: 1, direction: "TB" });
    await expect(page.getByTestId("lab-control-nodes")).toHaveValue("25");
    await expect(page.getByTestId("lab-control-groups")).toBeChecked();
    await expect(page.getByTestId("lab-control-direction")).toHaveValue("TB");
    await expect(page.getByTestId("lab-diagram-stats")).toContainText("25 nodes");
    await expect(page.getByTestId(/^node-n\d+$/)).toHaveCount(25);
    await expect(page.getByTestId("group-col1")).toBeVisible();

    await page.getByTestId("lab-control-nodes").fill("12");
    await page.getByTestId("lab-control-nodes").press("Enter");
    await expect(page.getByTestId("lab-diagram-stats")).toContainText("12 nodes");
    await expect(page).toHaveURL(/nodes=12/);
    await expect(page).toHaveURL(/groups=1/);

    await page.getByTestId("lab-reset-controls").click();
    await expect(page.getByTestId("lab-diagram-stats")).toContainText("10 nodes");
    await expect(page).not.toHaveURL(/nodes=/);
  });

  test("junk URL values fall back to defaults", async ({ page }) => {
    await gotoLab(page, "stress-10", { nodes: "lots", direction: "sideways" });
    await expect(page.getByTestId("lab-control-nodes")).toHaveValue("10");
    await expect(page.getByTestId("lab-control-direction")).toHaveValue("LR");
  });

  test("look params set the theme and renderers", async ({ page }) => {
    await gotoLab(page, "nodes-states", { theme: "dark", nodevariant: "compact", edgestyle: "bezier", variant: "card" });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    await expect(page.getByTestId("lab-look-nodevariant")).toHaveValue("compact");
    await expect(page.getByTestId("lab-look-edgestyle")).toHaveValue("bezier");
    await expect(page.getByTestId("variant-picker")).toHaveValue("compact");
    // The preset's own variant control is independent of the global look.
    await expect(page.getByTestId("lab-node-variant-card")).toBeVisible();
    await expect(page.getByTestId("lab-node-variant-compact")).toHaveCount(0);

    await page.getByTestId("lab-look-theme").selectOption("light");
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    await expect(page).not.toHaveURL(/theme=/);
  });

  test("sidebar search, selection and Back", async ({ page }) => {
    await gotoLab(page, "nodes-states");
    await page.getByTestId("lab-search").fill("stress");
    await expect(page.getByTestId("lab-preset-link-stress-50")).toBeVisible();
    await expect(page.getByTestId("lab-preset-link-nodes-states")).toHaveCount(0);
    await page.getByTestId("lab-preset-link-stress-50").click();
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "stress-50");
    await expect(page).toHaveURL(/preset=stress-50/);
    await expect(page.getByTestId("lab-preset-title")).toHaveText("Stress: 50 nodes");
    await page.goBack();
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "nodes-states");
  });

  test("keyboard: [ and ] step through presets", async ({ page }) => {
    await gotoLab(page, "nodes-all-stencils");
    await page.keyboard.press("]");
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "nodes-playground");
    await page.keyboard.press("[");
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "nodes-all-stencils");
  });

  test("Load JSON renders a pasted diagram and rejects bad input", async ({ page }) => {
    await gotoLab(page, "edges-kinds");
    await page.getByTestId("lab-json-toggle").click();
    await page.getByTestId("lab-json-input").fill("{ not json");
    await page.getByTestId("lab-json-apply").click();
    await expect(page.getByTestId("lab-json-error")).toContainText("isn't valid JSON");

    const diagram = {
      format: "diagrams/v1",
      title: "Pasted",
      nodes: [
        { id: "p1", stencil: "kafka.topic", label: "Pasted topic", x: 0, y: 0 },
        { id: "p2", stencil: "service.go", label: "Pasted service", x: 360, y: 0 },
      ],
      edges: [{ id: "pe", from: "p1", to: "p2" }],
    };
    await page.getByTestId("lab-json-input").fill(JSON.stringify(diagram));
    await page.getByTestId("lab-json-apply").click();
    await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "custom-json");
    await expect(page.getByTestId("node-p1")).toBeVisible();
    await expect(page.getByTestId("node-p2")).toBeVisible();

    // Survives a reload (kept in localStorage).
    await page.reload();
    await expect(page.getByTestId("node-p1")).toBeVisible();

    // "Use current" copies the current preset's diagram into the box.
    await page.getByTestId("lab-preset-link-cycle").click();
    await page.getByTestId("lab-json-toggle").click();
    await page.getByTestId("lab-json-from-preset").click();
    await expect(page.getByTestId("lab-json-input")).toHaveValue(/"title": "Cycle of 8"/);
  });

  test("Open in editor hands examples and generated diagrams to the canvas", async ({ page }) => {
    const ex = publicExamples[0];
    await gotoLab(page, `example-${ex.slug}`);
    await page.getByTestId("lab-open-editor").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`example=${ex.slug}`));

    await gotoLab(page, "stress-10");
    await page.getByTestId("lab-open-editor").click();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("example-picker")).toHaveValue("imported");
    await expect(page.getByTestId("node-n1")).toBeVisible();
  });

  test("scenario readout runs the engine and evaluates its checks", async ({ page }) => {
    await gotoLab(page, "sim-fan-out", { autoplay: 0 });
    const readout = page.getByTestId("sim-readout");
    if (!(await readout.isVisible().catch(() => false))) {
      await expect(page.getByTestId("sim-unavailable").or(readout)).toBeVisible();
      test.skip(await page.getByTestId("sim-unavailable").isVisible(), "sim engine not available yet");
    }
    await expect(page.getByTestId("sim-time")).toHaveAttribute("data-ms", "0");
    await expect(page.getByTestId("sim-node-topic")).toBeVisible();
    await page.getByTestId("sim-step").click();
    await expect(page.getByTestId("sim-time")).not.toHaveAttribute("data-ms", "0");
    await page.getByTestId("sim-fast-forward").click();
    await expect(page.getByTestId("sim-checks-summary")).not.toHaveAttribute("data-status", "pending");
    await expect(page.getByTestId("sim-check-0")).not.toHaveAttribute("data-status", "pending");
    await page.getByTestId("sim-restart").click();
    await expect(page.getByTestId("sim-time")).toHaveAttribute("data-ms", "0");
  });
});
