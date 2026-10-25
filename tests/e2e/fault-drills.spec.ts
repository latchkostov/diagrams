import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { faultDrillFixture } from "../../src/lab/faultDrillFixture";
import {
  test,
  expect,
  gotoLive,
  waitForCameraIdle,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  expectNoErrors,
} from "./fixtures";

const item = (page: Page, id: string) => page.getByTestId(`context-menu-item-${id}`);
async function seed(page: Page, diagram = faultDrillFixture()) {
  await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
    key: STORAGE_KEYS.autosavePrefix + "kafka-order-pipeline",
    diagram,
  });
  await gotoLive(page, "./?view=canvas&example=kafka-order-pipeline&live=1&traffic=0&paused=1");
  await waitForCameraIdle(page);
}
async function faultMenu(page: Page, target: string) {
  await waitForCameraIdle(page);
  await page.getByTestId(target).click({ button: "right" });
  await item(page, "sim.fault").click();
}
const nodeCount = (page: Page, id: string, field: string) =>
  page.getByTestId(`node-badge-${id}`).getAttribute(`data-${field}`).then(Number);

for (const cancel of ["close", "escape"] as const) {
  test(`simulation authoring loads only on open and ${cancel} cancels its pending panel`, async ({ page }) => {
    test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
    const editor = /\/assets\/SimPanel-[A-Za-z0-9_-]+\.js(?:\?.*)?$/;
    let requested = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(editor, async (route) => {
      requested = true;
      await held;
      await route.continue();
    });
    try {
      await seed(page);
      expect(requested).toBe(false);
      await page.getByTestId("live-more").click();
      await expect.poll(() => requested).toBe(true);
      await page.getByTestId("live-edit-sims").click();
      await expect(page.getByTestId("sim-panel-loading")).toBeVisible();
      await expect(page.getByTestId("sim-panel-heading")).toBeFocused();
      await waitForCameraIdle(page);
      const panelBox = await page.getByTestId("sim-panel").boundingBox();
      const workerBox = await page.getByTestId("node-worker").boundingBox();
      if (!panelBox || !workerBox) throw new Error("Missing lazy panel geometry");
      expect(workerBox.x + workerBox.width).toBeLessThanOrEqual(panelBox.x);
      await expect.poll(() => requested).toBe(true);
      if (cancel === "close") await page.getByTestId("sim-panel-close").click();
      else await page.keyboard.press("Escape");
      await expect(page.getByTestId("sim-panel-loading")).toHaveCount(0);
      if (cancel === "escape") await expect(page.getByTestId("live-more")).toBeFocused();
      const downloaded = page.waitForResponse((response) => editor.test(response.url()));
      release();
      await (await downloaded).finished();
      await expect(page.getByTestId("sim-panel")).toHaveCount(0);
      await expect(page.getByTestId("live-controls")).toBeVisible();
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-edit-sims").click();
      await expect(page.getByTestId("sim-panel-new")).toBeVisible();
      await expect(page.getByTestId("sim-panel-heading")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("sim-panel")).toHaveCount(0);
      await expect(page.getByTestId("live-more")).toBeFocused();
    } finally {
      release();
    }
  });
}

test("the loaded simulations panel retains its opener through the lazy loading handoff", async ({ page }) => {
  test.skip(process.env.E2E_TARGET !== "build", "Checks the production chunk boundary");
  const editor = /\/assets\/SimPanel-[A-Za-z0-9_-]+\.js(?:\?.*)?$/;
  let requested = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(editor, async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
  try {
    await seed(page);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByTestId("sim-panel-loading")).toBeVisible();
    await expect(page.getByTestId("sim-panel-heading")).toBeFocused();
    release();
    await expect(page.getByTestId("sim-panel-new")).toBeVisible();
    await expect(page.getByTestId("sim-panel-heading")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sim-panel")).toHaveCount(0);
    await expect(page.getByTestId("live-more")).toBeFocused();
  } finally {
    release();
  }
});

test("boundary Fault takes every member down, greys the boundary, restores it and clears on leaving Live", async ({
  page,
  consoleErrors,
}) => {
  await seed(page);
  await faultMenu(page, "node-worker");
  await item(page, "sim.kill").click();
  await faultMenu(page, "group-label-zone-b");
  await expect(item(page, "sim.boundary-down")).toHaveText("Take down");
  await item(page, "sim.boundary-down").click();
  for (const id of ["worker", "store"])
    await expect(page.getByTestId(`node-badge-${id}`)).toHaveAttribute("data-status", "down");
  await faultMenu(page, "node-worker");
  await expect(item(page, "sim.kill")).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, "sim.kill")).toContainText("Restore Zone b first.");
  await page.keyboard.press("Escape");
  const boundary = page.getByTestId("group-zone-b");
  await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("grayscale(1)");
  await faultMenu(page, "group-label-zone-b");
  await expect(item(page, "sim.boundary-down")).toHaveText("Restore");
  await item(page, "sim.boundary-down").click();
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-status", "down");
  await expect(page.getByTestId("node-badge-store")).toHaveAttribute("data-status", "up");
  await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  await faultMenu(page, "node-worker");
  await expect(item(page, "sim.kill")).not.toHaveAttribute("aria-disabled", "true");
  await item(page, "sim.kill").click();
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-status", "up");
  await faultMenu(page, "group-label-zone-b");
  await item(page, "sim.boundary-down").click();
  await page.getByTestId("live-toggle").click();
  await expect.poll(() => boundary.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  expectNoErrors(consoleErrors);
});

test("node Fault applies slowdown and failures, keeps them checked, and clears overlays without saving props", async ({
  page,
}) => {
  await seed(page);
  await faultMenu(page, "node-worker");
  await item(page, "sim.slow").click();
  await item(page, "sim.slow:10").click();
  await expect(page.getByTestId("node-fault-worker")).toHaveText("10× slower");
  await faultMenu(page, "node-worker");
  await item(page, "sim.slow").click();
  await expect(item(page, "sim.slow:10")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await faultMenu(page, "node-worker");
  await item(page, "sim.failure").click();
  await item(page, "sim.failure:0.5").click();
  await expect(page.getByTestId("node-fault-worker")).toHaveText("10× slower · fails 50%");
  await faultMenu(page, "node-worker");
  await item(page, "sim.failure").click();
  await expect(item(page, "sim.failure:0.5")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await faultMenu(page, "node-worker");
  await item(page, "sim.clear-faults").click();
  await expect(page.getByTestId("node-fault-worker")).toHaveCount(0);
  expect((await savedDiagram(page)).nodes.find((n) => n.id === "worker")?.props).toMatchObject({
    latencyMs: 100,
    failureRate: 0,
  });
});

test("Cut link fails pushed Requests, retains broker deliveries and restores the link", async ({ page }) => {
  await page.clock.install();
  await seed(page);
  await pauseClock(page);
  await faultMenu(page, "edge-label-request");
  await item(page, "sim.cut-link").click();
  await page.getByTestId("node-caller").click({ button: "right" });
  await item(page, "sim.inject").click();
  await item(page, "sim.inject:10").click();
  await expect.poll(() => nodeCount(page, "worker", "dropped")).toBe(10);
  await faultMenu(page, "edge-label-delivery");
  await item(page, "sim.cut-link").click();
  await page.getByTestId("node-queue").click({ button: "right" });
  await item(page, "sim.inject").click();
  await item(page, "sim.inject:10").click();
  await expect.poll(() => nodeCount(page, "queue", "backlog")).toBe(10);
  // Playback advances only through explicit steps, independent of the machine's frame rate.
  await faultMenu(page, "edge-label-delivery");
  await expect(item(page, "sim.cut-link")).toHaveText("Restore link");
  await item(page, "sim.cut-link").click();
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-step").click();
  await expect.poll(() => nodeCount(page, "worker", "processed")).toBe(10);
});

test("fault step edits survive save and reopen", async ({ page }) => {
  const diagram = faultDrillFixture();
  const worker = diagram.nodes.find((node) => node.id === "worker");
  if (!worker) throw new Error("The fault drill fixture has no worker node");
  worker.stencil = "nginx";
  await seed(page, diagram);
  await page.getByTestId("node-worker").click({ button: "right" });
  await item(page, "sim.storm").click();
  await page.getByTestId("sim-panel-section-timeline-toggle").click();
  const presets = ["zone-outage", "region-connectivity", "slow-dependency", "error-spike"];
  for (const [i, preset] of presets.entries()) {
    await page.getByTestId("sim-panel-add-step").selectOption(preset);
    await expect(page.getByTestId(`sim-panel-step-${i + 1}-action`)).toHaveValue("fault");
    await expect(page.getByTestId(`sim-panel-step-${i + 1}-fault-target`)).toHaveAccessibleName("Target");
    for (const field of ["kind", "target", "value"]) {
      expect(
        await page
          .getByTestId(`sim-panel-step-${i + 1}-fault-${field}`)
          .evaluate((el) => (el as HTMLSelectElement).labels?.[0]?.textContent),
      ).toBeTruthy();
    }
    if (preset === "slow-dependency" || preset === "error-spike")
      await expect(page.getByTestId(`sim-panel-step-${i + 1}-fault-target`)).toHaveValue("worker");
  }
  await page.getByTestId("sim-panel-step-1-fault-target").selectOption("zone-b");
  await page.getByTestId("sim-panel-step-1-fault-value").selectOption("false");
  await page.getByTestId("sim-panel-step-1-time").fill("1.5");
  await page.getByTestId("sim-panel-step-2-fault-target").selectOption("request");
  await page.getByTestId("sim-panel-step-2-fault-value").selectOption("false");
  await page.getByTestId("sim-panel-step-2-time").fill("3.5");
  await page.getByTestId("sim-panel-step-3-fault-kind").selectOption("fail");
  await expect(page.getByTestId("sim-panel-step-3-fault-kind")).toHaveValue("fail");
  await page.getByTestId("sim-panel-step-3-fault-kind").selectOption("slow");
  await expect(page.getByTestId("sim-panel-step-3-fault-kind")).toHaveValue("slow");
  await page.getByTestId("sim-panel-step-3-fault-target").selectOption("store");
  await page.getByTestId("sim-panel-step-3-fault-value").selectOption("10");
  await page.getByTestId("sim-panel-step-3-time").fill("5.5");
  await page.getByTestId("sim-panel-step-4-fault-target").selectOption("queue");
  await page.getByTestId("sim-panel-step-4-fault-value").selectOption("0.1");
  await page.getByTestId("sim-panel-step-4-time").fill("7.5");
  await page.getByTestId("sim-panel-save").click();
  const timeline = [
    { atMs: 0, action: { do: "note", text: "100 MemberJoined messages arrive at Worker." } },
    {
      atMs: 1500,
      action: { do: "fault", fault: { kind: "boundary", boundary: "zone-b", down: false }, drill: "zone-outage" },
    },
    {
      atMs: 3500,
      action: { do: "fault", fault: { kind: "link", edge: "request", cut: false }, drill: "region-connectivity" },
    },
    {
      atMs: 5500,
      // A kind change makes a custom fault and deliberately clears preset metadata.
      action: { do: "fault", fault: { kind: "slow", node: "store", factor: 10 } },
    },
    { atMs: 7500, action: { do: "fault", fault: { kind: "fail", node: "queue", rate: 0.1 }, drill: "error-spike" } },
  ];
  await expect.poll(async () => (await savedDiagram(page)).simulations?.at(-1)?.timeline).toEqual(timeline);
  await page.getByTestId("sim-panel-back").click();
  await page.getByTestId("sim-panel-edit-storm-worker").click();
  await page.getByTestId("sim-panel-section-timeline-toggle").click();
  for (const [i, target, value, time, kind] of [
    [1, "zone-b", "false", "1.5", "boundary"],
    [2, "request", "false", "3.5", "link"],
    [3, "store", "10", "5.5", "slow"],
    [4, "queue", "0.1", "7.5", "fail"],
  ]) {
    await expect(page.getByTestId(`sim-panel-step-${i}-fault-kind`)).toHaveValue(String(kind));
    await expect(page.getByTestId(`sim-panel-step-${i}-fault-target`)).toHaveValue(String(target));
    await expect(page.getByTestId(`sim-panel-step-${i}-fault-value`)).toHaveValue(String(value));
    await expect(page.getByTestId(`sim-panel-step-${i}-time`)).toHaveValue(String(time));
  }
});

for (const layout of ["ungrouped", "same-boundary"] as const) {
  test(`unavailable fault presets keep playback usable: ${layout}`, async ({ page, consoleErrors }) => {
    await page.clock.install();
    const d = faultDrillFixture();
    if (layout === "ungrouped") {
      d.groups = [];
      d.nodes.forEach((n) => {
        delete n.group;
      });
    } else
      d.nodes.forEach((n) => {
        n.group = "zone-a";
      });
    const simulation = d.simulations?.[0];
    if (!simulation) throw new Error("The fault fixture needs a saved simulation");
    simulation.traffic = [{ id: "load", node: "caller", shape: { kind: "burst", count: 10 } }];
    simulation.timeline = [
      {
        atMs: 500,
        action: {
          do: "fault",
          fault:
            layout === "ungrouped"
              ? { kind: "boundary", boundary: "missing-zone", down: true }
              : { kind: "link", edge: "request", cut: true },
        },
      },
    ];
    await seed(page, d);
    await pauseClock(page);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await page.getByTestId("sim-panel-edit-drill").click();
    await page.getByTestId("sim-panel-section-timeline-toggle").click();
    await expect(page.getByTestId("sim-panel-preset-region-connectivity")).toBeDisabled();
    if (layout === "ungrouped") await expect(page.getByTestId("sim-panel-preset-zone-outage")).toBeDisabled();
    await expect(page.getByTestId("sim-panel-preset-region-connectivity")).toContainText(
      "needs a link between two boundaries",
    );
    await expect(page.getByTestId("sim-panel-unavailable-faults")).toHaveCount(0);
    await expect(page.getByTestId("sim-panel-warnings")).toContainText(
      "Choose an available target or remove this step",
    );
    await expect(page.getByTestId("sim-panel-run")).toBeDisabled();
    await page.getByTestId("sim-panel-step-0-fault-kind").selectOption("slow");
    await page.getByTestId("sim-panel-step-0-fault-value").selectOption("1");
    await expect(page.getByTestId("sim-panel-run")).toBeEnabled();
    await page.getByTestId("sim-panel-run").click();
    await page.getByTestId("sim-panel-close").click();
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-step").click();
    await expect.poll(() => nodeCount(page, "worker", "processed")).toBeGreaterThan(0);
    expectNoErrors(consoleErrors);
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`cut and restored Request and Message styles are distinct in ${theme}`, async ({ page }) => {
    await page.addInitScript(({ theme, key }) => localStorage.setItem(key, JSON.stringify({ theme })), {
      theme,
      key: STORAGE_KEYS.settings,
    });
    await seed(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    const style = (id: string) =>
      page.getByTestId(`edge-${id}`).evaluate((el) => {
        const path = [...el.children][1];
        const computed = getComputedStyle(path);
        return { stroke: computed.stroke, dash: computed.strokeDasharray, opacity: computed.opacity };
      });
    for (const id of ["request", "delivery"]) {
      await page.getByTestId(`edge-label-${id}`).click();
      await waitForCameraIdle(page);
      // Camera idle precedes Live's idle-opacity fade. Save the settled visual
      // baseline, never an intermediate opacity that restoration cannot match.
      await expect.poll(async () => (await style(id)).opacity).toBe("0.4");
      const restored = await style(id);
      await faultMenu(page, `edge-label-${id}`);
      await item(page, "sim.cut-link").click();
      await expect.poll(() => style(id)).toEqual({ stroke: expect.any(String), dash: "4px, 8px", opacity: "0.55" });
      expect((await style(id)).stroke).not.toBe(restored.stroke);
      await faultMenu(page, `edge-label-${id}`);
      await item(page, "sim.cut-link").click();
      await expect.poll(() => style(id)).toEqual(restored);
    }
  });
}

test("Zone outage drill shifts traffic by 5 s without loss; the second simulation visibly loses requests", async ({
  page,
}) => {
  await gotoLive(page, "./?view=canvas&example=zone-outage-drill&sim=health-checks&paused=1");
  const seek = page.getByTestId("live-timeline-input");
  await seek.fill("560");
  await seek.press("ArrowRight");
  await expect(page.getByTestId("node-badge-api-b")).toHaveAttribute("data-status", "down");
  await expect
    .poll(() => page.getByTestId("group-zone-b").evaluate((el) => getComputedStyle(el).filter))
    .toBe("grayscale(1)");
  expect(await nodeCount(page, "api-b", "dropped")).toBe(0);
  await expect(page.getByTestId("node-loss-api-b")).toHaveCount(0);
  expect(await nodeCount(page, "api-a", "processed")).toBeGreaterThan(await nodeCount(page, "api-b", "processed"));
  await seek.fill("1000");
  await seek.press("ArrowRight");
  await expect(page.getByTestId("live-run-result")).toHaveText("No messages lost");
  await page.getByTestId("live-sim-picker").selectOption("no-health-checks");
  await seek.fill("560");
  await seek.press("ArrowRight");
  await expect.poll(() => nodeCount(page, "api-b", "dropped")).toBeGreaterThan(0);
  await expect(page.getByTestId("node-loss-api-b")).toBeVisible();
  await expect(page.getByTestId("trouble-callout")).toHaveCount(0);
  await seek.fill("1000");
  await seek.press("ArrowRight");
  await expect(page.getByTestId("live-done")).toHaveAttribute("data-status", "fail");
  await expect(page.getByTestId("live-done")).toHaveText("4/5");
  await expect(page.getByTestId("live-run-result")).toHaveText("Lost 26 messages at Checkout API b");
  await expect(page.getByTestId("expectation-api-b-loss")).toHaveAttribute(
    "aria-label",
    /No checkouts lost at Checkout API b: failed/,
  );
  await expect(page.getByTestId("node-loss-api-b")).toHaveAttribute("title", /messages? dropped/);
  await expect
    .poll(() => page.getByTestId("group-zone-b").evaluate((el) => getComputedStyle(el).filter))
    .toBe("grayscale(1)");
  await page.screenshot({ path: test.info().outputPath("zone-outage.png") });
});

test("boundary callout restores the zone, not a member, and names it", async ({ page }) => {
  await seed(page);
  await faultMenu(page, "group-label-zone-b");
  await item(page, "sim.boundary-down").click();
  await expect(page.getByTestId("trouble-headline")).toHaveText("Zone b is down");
  await expect(page.getByTestId("trouble-detail")).toHaveText(
    "No messages dropped here. New requests can go elsewhere.",
  );
  await expect(page.getByTestId("trouble-action")).toHaveText("Restore Zone b");
  await expect(page.getByTestId("trouble-action")).toBeEnabled();
  await page.getByTestId("trouble-action").click();
  await expect(page.getByTestId("node-badge-worker")).toHaveAttribute("data-status", "up");
});

test("fault-caused loss offers Clear fault rather than capacity advice", async ({ page }) => {
  await seed(page);
  await faultMenu(page, "node-worker");
  await item(page, "sim.failure").click();
  await item(page, "sim.failure:0.5").click();
  await expect(page.getByTestId("node-fault-worker")).toHaveText("fails 50%");
  await page.getByTestId("node-worker").click({ button: "right" });
  await item(page, "sim.inject").click();
  await item(page, "sim.inject:100").click();
  await page.getByTestId("live-more").click();
  for (let i = 0; i < 24; i++) await page.getByTestId("live-step").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("trouble-detail")).toContainText("fails 50%");
  await expect(page.getByTestId("trouble-action")).toHaveText("Clear fault");
  await page.getByTestId("trouble-action").click();
  await expect(page.getByTestId("node-fault-worker")).toHaveCount(0);
  await faultMenu(page, "group-label-zone-b");
  await item(page, "sim.boundary-down").click();
  await expect(page.getByTestId("node-metric-worker")).toHaveCount(0);
});

test("fault markers and expectations show names, and overflow supports arrow keys", async ({ page }) => {
  await gotoLive(page, "./?view=canvas&example=zone-outage-drill&sim=health-checks&paused=1");
  await expect(page.getByTestId("live-marker-0")).toHaveAttribute("aria-label", /Zone outage: Zone b/);

  // Marker test ids carry positions, while their accessible labels carry the authored names.
  await expect(page.getByTestId("expectation-api-b-loss")).toHaveAttribute("aria-label", /Checkout API b/);
  await page.getByTestId("live-more").click();
  await page.getByTestId("live-traffic").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("live-edit-sims")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("live-traffic")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("live-step")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("live-traffic")).toBeFocused();
});

test("Go Live opens Free play on examples and personal diagrams, with saved drills one choice away", async ({
  page,
}) => {
  await page.goto("./?view=canvas&example=zone-outage-drill");
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("");
  await expect(page.getByTestId("live-timeline-input")).toHaveCount(0);
  await page.getByTestId("live-sim-picker").selectOption("health-checks");
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("health-checks");
  await expect(page.getByTestId("live-timeline-input")).toBeVisible();
  // A saved personal copy has the same Free play default.
  await page.getByTestId("live-toggle").click();
  await page.getByTestId("import-input").setInputFiles({
    name: "own-diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(faultDrillFixture())),
  });
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-sim-picker")).toHaveValue("");
});

for (const theme of ["light", "dark"] as const)
  test(`P2 blocking validation announces named fields and limits in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await seed(page);
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    await page.getByTestId("sim-panel-new").click();
    const error = page.getByTestId("sim-panel-invalid");
    await expect(error).toHaveAttribute("role", "status");
    await expect(error).toHaveAttribute("aria-live", "polite");
    await expect(error).toHaveAttribute("aria-atomic", "true");
    await page.getByTestId("sim-panel-add-traffic").click();
    const count = page.getByTestId("sim-panel-traffic-0-count");
    await count.fill("100001");
    await expect(count).toBeFocused();
    await expect(count).toHaveAttribute("aria-invalid", "true");
    await expect(count).toHaveAccessibleDescription("Traffic 1: Messages: enter a whole number from 0 to 100,000.");
    await expect(page.getByTestId("sim-panel-save")).toBeDisabled();
    await expect(page.getByTestId("sim-panel-save")).toHaveAttribute("aria-describedby", "sim-panel-invalid");
    await expect(error).toContainText("Traffic 1: Messages");
    await count.fill("100");
    await expect(count).not.toHaveAttribute("aria-invalid");
    await expect(error).toBeEmpty();
    await expect(error).toHaveCSS("padding", "0px");
    await expect(error).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.getByTestId("sim-panel-section-timeline-toggle").click();
    await page.getByTestId("sim-panel-add-step").selectOption("zone-outage");
    const target = page.getByTestId("sim-panel-step-0-fault-target");
    // An invalid edit remains visible and repairable, as after a referenced boundary disappears.
    await target.evaluate((el) => {
      const select = el as HTMLSelectElement;
      select.add(new Option("Missing boundary", "missing"));
      select.value = "missing";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(target).toHaveAttribute("aria-invalid", "true");
    await expect(target).toHaveAccessibleDescription("Timeline 1: Target: choose an existing target in this diagram.");
    await expect(page.getByTestId("sim-panel-save")).toBeDisabled();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .include('[data-testid="sim-panel"]')
      .analyze();
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await target.selectOption("zone-b");
    await expect(error).toBeEmpty();
    await expect(page.getByTestId("sim-panel-save")).toBeEnabled();
  });
