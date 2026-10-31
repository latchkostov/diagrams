import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  savedDiagram,
  STORAGE_KEYS,
  pauseClock,
  openCheckFinding,
} from "./fixtures";
import { openNativeSelect } from "./native-select";
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
    const primaryText = (await primary.innerText()).trim();
    await openCheckFinding(page, "scaling-blind:caller");
    await expect(blind).toHaveText(primaryText);
    await openCheckFinding(page, "blocked-threads:caller");
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
    await openCheckFinding(page, "blocked-threads:caller");
    await expect(primary).toBeEnabled();
    await primary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("check-row-scaling-blind:caller")).toHaveCount(0);
    await expect(page.getByTestId("autoscaling-target")).toBeFocused();
  });

  test(`replica alternative replaces autoscaling with a fixed fleet in one undo step in ${locale}`, async ({
    page,
  }) => {
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
    const replicas = page.getByTestId("check-fix-option-1-blocked-threads:caller");
    await expect(replicas).toBeEnabled();
    if (locale === "en") await expect(replicas).toHaveText("Add replicas (12; fixed fleet)");
    await replicas.focus();
    await page.keyboard.press("Enter");
    const caller = async () => (await savedDiagram(page)).nodes.find((n) => n.id === "caller")?.props;
    await expect.poll(caller).toMatchObject({ replicas: 12, autoscaling: { mode: "off" } });
    await page.getByTestId("check-fix-undo").focus();
    await page.keyboard.press("Enter");
    const original = busy.nodes.find((n) => n.id === "caller")?.props;
    await expect.poll(async () => (await caller())?.replicas).toBe(original?.replicas);
    expect((await caller())?.autoscaling).toEqual(original?.autoscaling);
  });

  test(`an inspector alternative that removes two findings keeps keyboard focus in ${locale}`, async ({ page }) => {
    await page.addInitScript((locale) => localStorage.setItem("diagrams.locale", locale), locale);
    // One of Your diagrams, so the fix edits it in place (an example's first edit opens a copy, unselected).
    await gotoCanvas(page, "aks-app-config-key-vault");
    await page.getByTestId("import-input").setInputFiles({
      name: "busy.diagram.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(busy)),
    });
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    // The first check (in the worker, verification replays included) has finished.
    await expect(page.getByTestId("checks-count")).toBeVisible();
    await page.getByTestId("node-caller").dblclick();
    const free = page.getByTestId("inspector-check-fix-option-0-blocked-threads:caller");
    await expect(free).toBeEnabled();
    await expect(page.getByTestId("inspector-check-row-scaling-blind:caller")).toBeVisible();
    await free.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await savedDiagram(page)).edges.find((e) => e.id === "call")?.props?.caller)
      .toMatchObject({ wait: "non-blocking" });
    await expect(page.getByTestId("inspector-check-row-blocked-threads:caller")).toHaveCount(0);
    await expect(page.getByTestId("inspector-check-row-scaling-blind:caller")).toHaveCount(0);
    // Applying an edit drops the selection, and the inspector's findings with it: focus stays in the inspector, never
    // the page, and the keyboard carries on from there.
    await expect(page.getByTestId("inspector-body")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.querySelector('[data-testid="inspector"]')?.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.getByTestId("check-fix-undo").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspector-check-row-blocked-threads:caller")).toBeVisible();
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
    await page.getByTestId("live-expectations-summary").click();
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
    // macOS opens the popup on ArrowDown; a later Tab cancels that choice. Explicitly open and commit it.
    await openNativeSelect(page, field);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(field).toHaveValue("threadsWaiting");
    const words = await field.evaluate((el: HTMLSelectElement) => el.selectedOptions[0].textContent);
    if (locale === "en") expect(words).toBe("threads waiting");
    else expect(words).not.toBe("threads waiting");
  });
}
