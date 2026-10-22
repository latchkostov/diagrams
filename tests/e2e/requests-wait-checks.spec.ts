import { test, expect, gotoCanvas, gotoLive, savedDiagram, STORAGE_KEYS, pauseClock } from "./fixtures";
import busy from "../../src/examples/scale-on-busy-threads.json" with { type: "json" };
import payment from "../../src/examples/slow-payment-provider.json" with { type: "json" };
import { waitingFixture } from "../../src/lab/waitingFixture";

test("worker fallback keeps the displayed timeout actionable", async ({ page }) => {
  await page.addInitScript(
    ({ key, d }) => {
      Object.defineProperty(window, "Worker", { value: undefined });
      localStorage.setItem(key, JSON.stringify(d));
    },
    { key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider", d: payment },
  );
  await gotoCanvas(page, "slow-payment-provider");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("Check diagram");
  await page.getByTestId("command-input").press("Enter");
  const fix = page.getByTestId("check-fix-call-timeout:pay");
  await expect(fix).toBeEnabled();
  await fix.click();
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "pay")?.props?.caller)
    .toMatchObject({ deadlineMs: 600 });
  await page.getByTestId("check-fix-undo").click();
  await expect(fix).toBeEnabled();
});

test("the timeout Check leaves a slow selected endpoint time to reply", async ({ page }) => {
  const d = waitingFixture();
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 1 };
  d.nodes[1].props = { ...d.nodes[1].props, concurrency: 10 };
  d.nodes[2].props = {
    latencyMs: 200,
    api: { latencyMs: 250 },
    endpoints: [{ id: "slow", method: "GET", path: "/slow", behaviour: { latencyMs: 2000 } }],
  };
  d.edges[1].props = { endpointId: "slow", networkDelayMs: 25 };
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("Check diagram");
  await page.getByTestId("command-input").press("Enter");
  const fix = page.getByTestId("check-fix-call-timeout:call");
  await expect(fix).toContainText("8,000 ms");
  await fix.click();
  await expect
    .poll(
      async () =>
        ((await savedDiagram(page)).edges.find((e) => e.id === "call")?.props?.caller as { deadlineMs?: number })
          ?.deadlineMs,
    )
    .toBe(8000);
});

for (const locale of ["en", "ar", "en-XA"]) {
  test(`Checks expose the verified primary fix and keyboard option chips in ${locale}`, async ({ page }) => {
    await page.addInitScript(
      ({ key, d, locale }) => {
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem("diagrams.locale", locale);
      },
      { key: STORAGE_KEYS.autosavePrefix + "scale-on-busy-threads", d: busy, locale },
    );
    await gotoCanvas(page, "scale-on-busy-threads");
    await page.getByTestId("checks-count").focus();
    await page.keyboard.press("Enter");
    const primary = page.getByTestId("check-fix-blocked-threads:caller");
    const blind = page.getByTestId("check-fix-scaling-blind:caller");
    await expect(primary).toBeEnabled();
    await expect(blind).toHaveText((await primary.innerText()).trim());
    const timeout = page.getByTestId("check-row-call-timeout:call");
    await expect(timeout).toBeVisible();
    if (locale === "en") await expect(primary).toContainText("Scale on busy threads");
    else await expect(primary).not.toHaveText("Scale on busy threads");
    const free = page.getByTestId("check-fix-option-0-blocked-threads:caller");
    await expect(page.getByTestId("check-fix-option-1-blocked-threads:caller")).toBeVisible();
    await free.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "call")?.props?.caller)
      .toMatchObject({ wait: "non-blocking" });
    await expect(page.getByTestId("check-row-blocked-threads:caller")).toHaveCount(0);
    await expect(page.getByTestId("check-row-scaling-blind:caller")).toHaveCount(0);
    await expect(page.getByTestId("check-select-call-timeout:call")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("check-select-call-timeout:call")).toBeFocused();
    await page.getByTestId("check-fix-undo").focus();
    await page.keyboard.press("Enter");
    await expect(primary).toBeEnabled();
    await primary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("check-row-scaling-blind:caller")).toHaveCount(0);
    await expect(page.getByTestId("autoscaling-target")).toBeFocused();
  });

  test(`the payment timeout Check applies 600 ms in one keyboard undo step in ${locale}`, async ({ page }) => {
    await page.addInitScript(
      ({ key, d, locale }) => {
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem("diagrams.locale", locale);
      },
      { key: STORAGE_KEYS.autosavePrefix + "slow-payment-provider", d: payment, locale },
    );
    await gotoCanvas(page, "slow-payment-provider");
    // Suggestions have no warning count; open Checks through its registered palette action.
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("Check diagram");
    await page.getByTestId("command-input").press("Enter");
    const fix = page.getByTestId("check-fix-call-timeout:pay");
    await expect(fix).toBeEnabled();
    if (locale === "en") await expect(fix).toContainText("600 ms");
    else await expect(fix).not.toHaveText("Add a 600 ms timeout");
    await fix.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "pay")?.props?.caller)
      .toMatchObject({ deadlineMs: 600 });
    await expect(fix).toHaveCount(0);
    await page.getByTestId("check-fix-undo").focus();
    await page.keyboard.press("Enter");
    await expect(fix).toBeEnabled();
  });

  test(`thread expectation chips and metric picker work by keyboard in ${locale}`, async ({ page }) => {
    const d = waitingFixture();
    d.simulations = [
      {
        id: "threads",
        title: "Thread counts",
        seed: 1,
        scale: 1,
        durationMs: 3000,
        traffic: [{ id: "burst", node: "source", shape: { kind: "burst", count: 40 } }],
        expectations: [
          {
            id: "busy",
            label: "Busy",
            metric: { node: "caller", field: "threadsBusy" },
            op: ">",
            value: 0,
            when: "eventually",
          },
          {
            id: "waiting",
            label: "Waiting",
            metric: { node: "caller", field: "threadsWaiting" },
            op: ">",
            value: 0,
            when: "eventually",
          },
        ],
      },
    ];
    await page.addInitScript(
      ({ key, d, locale }) => {
        localStorage.setItem(key, JSON.stringify(d));
        localStorage.setItem("diagrams.locale", locale);
      },
      { key: STORAGE_KEYS.autosavePrefix + "blocking-call", d, locale },
    );
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1&sim=threads");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(1000);
    await page.getByTestId("live-play").click();
    for (const id of ["busy", "waiting"]) {
      const chip = page.getByTestId(`expectation-${id}`);
      await expect(chip).toHaveAttribute("data-status", "pass");
      await chip.focus();
      await expect(chip).toBeFocused();
    }
    await page.getByTestId("live-more").click();
    await page.getByTestId("live-edit-sims").click();
    const expectations = page.getByTestId("sim-panel-section-expectations-toggle");
    await expectations.focus();
    await expectations.press("Enter");
    const field = page.getByTestId("sim-panel-expectation-0-field");
    await expect(field).toHaveValue("threadsBusy");
    await field.focus();
    await expect(field).toBeFocused();
    await field.press("ArrowDown");
    await field.press("Tab");
    await expect(field).toHaveValue("threadsWaiting");
    const words = await field.evaluate((el: HTMLSelectElement) => el.selectedOptions[0].textContent);
    if (locale === "en") expect(words).toBe("threads waiting");
    else expect(words).not.toBe("threads waiting");
  });
}
