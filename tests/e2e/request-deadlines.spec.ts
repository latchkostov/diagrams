import { waitingFixture } from "../../src/lab/waitingFixture";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
} from "./fixtures";

test("Timeout validates whole milliseconds, bounds and clearing, and is undoable", async ({ page }) => {
  await page.clock.install();
  const d = waitingFixture();
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  const field = page.getByTestId("inspector-field-deadlineMs");
  await expect(field).toBeVisible();
  await field.fill("600");
  await page.clock.runFor(400);
  await expect.poll(async () => (await savedDiagram(page)).edges[1].props?.caller).toMatchObject({ deadlineMs: 600 });
  await field.fill("700000");
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ deadlineMs: 600000 });
  await field.fill("");
  await page.clock.runFor(400);
  await expect.poll(async () => (await savedDiagram(page)).edges[1].props?.caller).not.toHaveProperty("deadlineMs");
  await field.blur();
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).edges[1].props?.caller)
    .toMatchObject({ deadlineMs: 600000 });
});

for (const draft of ["1.5", "-"]) {
  test(`rejects ${draft === "1.5" ? "fractional" : "incomplete keyboard"} timeout without changing persisted policy`, async ({
    page,
  }) => {
    const d = waitingFixture();
    d.edges[1].props = { ...d.edges[1].props, caller: { deadlineMs: 600 } };
    await page.clock.install();
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      d,
    });
    await gotoCanvas(page, "blocking-call");
    await waitForStableViewport(page);
    await page.getByTestId("edge-call").dblclick();
    await page.getByTestId("inspector-section-edge-simulation").click();
    const field = page.getByTestId("inspector-field-deadlineMs");
    if (draft === "-") {
      await field.selectText();
      await field.press("-");
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("inspector-invalid-deadlineMs")).toBeVisible();
    } else {
      await field.fill(draft);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("inspector-invalid-deadlineMs")).toBeVisible();
    }
    await field.blur();
    if (draft === "1.5") {
      await expect(field).toHaveValue("600");
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
      await expect(page.getByTestId("inspector-invalid-deadlineMs")).toBeHidden();
    }
    await page.clock.runFor(400);
    expect((await savedDiagram(page)).edges[1].props?.caller).toMatchObject({ deadlineMs: 600 });
  });
}

test("an external timeout update replaces invalid feedback with the restored valid value", async ({ page }) => {
  const d = waitingFixture();
  d.edges[1].props = { ...d.edges[1].props, caller: { deadlineMs: 600 } };
  await page.clock.install();
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await page.getByTestId("edge-call").dblclick();
  await page.getByTestId("inspector-section-edge-simulation").click();
  const field = page.getByTestId("inspector-field-deadlineMs");
  await field.fill("700");
  await page.clock.runFor(400);
  await field.selectText();
  await field.press("-");
  await field.blur();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("inspector-invalid-deadlineMs")).toBeVisible();
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(400);
  await expect(field).toHaveValue("600");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("inspector-invalid-deadlineMs")).toBeHidden();
});

for (const disabled of [false, true]) {
  test(`the callout adds a timeout as one undo step (saved no-timeout override: ${disabled})`, async ({ page }) => {
    const d = waitingFixture();
    if (disabled) d.edges[1].props = { ...d.edges[1].props, caller: { deadlineMs: 600 } };
    d.simulations = [
      {
        id: "slow",
        title: "Slow call",
        durationMs: 20000,
        ...(disabled ? { setup: { edges: { call: { caller: { deadlineMs: null } } } } } : {}),
        traffic: [{ id: "traffic", node: "source", shape: { kind: "constant", ratePerSec: 100, durationMs: 20000 } }],
        timeline: [{ atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "partner", factor: 10 } } }],
      },
    ];
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      d,
    });
    await page.clock.install();
    await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1&sim=slow");
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(11000);
    await page.getByTestId("live-play").click();
    await expect(page.getByTestId("trouble-action")).toHaveText("Add a timeout");
    await page.getByTestId("trouble-action").click();
    await page.clock.runFor(400);
    await expect
      .poll(async () => {
        const saved = await savedDiagram(page);
        return disabled ? saved.simulations?.[0].setup?.edges?.call.caller : saved.edges[1].props?.caller;
      })
      .toMatchObject({ deadlineMs: 1000 });
    await page.getByTestId("undo-button").click();
    await page.clock.runFor(400);
    await expect
      .poll(async () => {
        const saved = await savedDiagram(page);
        return disabled ? saved.simulations?.[0].setup?.edges?.call.caller : saved.edges[1].props?.caller;
      })
      .toEqual(disabled ? { deadlineMs: null } : undefined);
    if (disabled) expect((await savedDiagram(page)).edges[1].props?.caller).toEqual({ deadlineMs: 600 });
  });
}

for (const simulation of ["no-timeouts", "timeout-600"]) {
  test(`slow payment provider: ${simulation}`, async ({ page }) => {
    await page.clock.install();
    await gotoLive(page, `./?view=canvas&example=slow-payment-provider&live=1&paused=1&sim=${simulation}`);
    await pauseClock(page);
    await page.getByTestId("live-play").click();
    await page.clock.runFor(8000);
    await page.getByTestId("live-play").click();
    const meter = page.getByTestId("thread-meter-checkout");
    const waiting = Number(await meter.getAttribute("data-waiting"));
    if (simulation === "no-timeouts") {
      expect(waiting).toBeGreaterThanOrEqual(98);
      await expect(page.getByTestId("call-pill-pay")).toContainText("held");
      await page.getByTestId("live-play").click();
      await page.clock.runFor(8000);
      await page.getByTestId("live-play").click();
      await expect(page.getByTestId("call-pill-route")).toContainText("timed out");
    } else {
      expect(waiting).toBeLessThan(80);
      await expect(page.getByTestId("call-pill-pay")).toContainText("✕");
      await expect(page.getByTestId("call-pill-pay")).toContainText("timed out");
      await expect(page.getByTestId("call-pill-route")).not.toContainText("timed out");
      await page.getByTestId("node-checkout").hover();
      await expect(page.getByTestId("call-timeouts-checkout")).toContainText("Timed out:");
      await expect(page.getByTestId("call-late-checkout")).toContainText("Late replies discarded:");
      for (const mode of ["is-compact", "is-summary"]) {
        expect(
          await page.getByTestId("call-outcomes-checkout").evaluate((element, mode) => {
            const detail = element.parentElement;
            if (!detail) return false;
            detail.classList.remove("is-compact", "is-summary");
            detail.classList.add(mode);
            return element.checkVisibility();
          }, mode),
        ).toBe(true);
        await expect(page.getByTestId("call-timeouts-checkout")).toBeVisible();
        await expect(page.getByTestId("call-late-checkout")).toBeVisible();
      }
    }
  });
}
