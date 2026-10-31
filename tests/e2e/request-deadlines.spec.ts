import { openLiveNodeDetails } from "./fixtures";
import { waitingFixture } from "../../src/lab/waitingFixture";
import type { Page } from "@playwright/test";
import { chunk, holdChunk } from "./chunk";
import { installThreadVerification, waitForThreadVerification } from "./thread-verification";
import {
  test,
  expect,
  gotoCanvas,
  gotoLive,
  pauseClock,
  savedDiagram,
  STORAGE_KEYS,
  waitForStableViewport,
  waitForInteractionIdle,
} from "./fixtures";

function timeoutFixture(disabled = false) {
  const d = waitingFixture();
  d.nodes[1].props = { ...d.nodes[1].props, concurrency: 100 };
  // Verification replays the diagram's own free-play traffic.
  d.nodes[0].props = { ...d.nodes[0].props, ratePerSec: 120 };
  if (disabled) d.edges[1].props = { ...d.edges[1].props, caller: { deadlineMs: 600 } };
  d.simulations = [
    {
      id: "slow",
      title: "Slow call",
      durationMs: 20000,
      ...(disabled ? { setup: { edges: { call: { caller: { deadlineMs: null } } } } } : {}),
      traffic: [{ id: "traffic", node: "source", shape: { kind: "constant", ratePerSec: 120, durationMs: 20000 } }],
      timeline: [{ atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "partner", factor: 10 } } }],
    },
  ];
  return d;
}

async function verifiedTrouble(page: Page, holdFirst = false, paused?: () => void) {
  await installThreadVerification(page, holdFirst);
  await page.clock.install();
  await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1&sim=slow");
  await pauseClock(page);
  await page.getByTestId("live-play").click();
  await page.clock.runFor(11000);
  await page.getByTestId("live-play").click();
  await expect(page.getByTestId("live-play")).toHaveAttribute("data-state", "paused");
  expect(Number(await page.getByTestId("live-canvas").getAttribute("data-sim-time"))).toBeGreaterThan(10000);
  paused?.();
  await waitForThreadVerification(page);
}

test("deadline setup cannot finish before the real verification response with the frame clock paused", async ({
  page,
}) => {
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d: timeoutFixture(),
  });
  const paused = Promise.withResolvers<undefined>();
  let finished = false;
  const opening = verifiedTrouble(page, true, () => paused.resolve(undefined)).then(() => {
    finished = true;
  });
  try {
    await Promise.race([paused.promise, opening]);
    await page.evaluate(() => window.__threadVerification?.whenRequested());
    expect(finished, "advancing the page clock does not complete a real worker replay").toBe(false);
    await page.evaluate(() => window.__threadVerification?.release?.());
    await opening;
    await expect(page.getByTestId("trouble-action")).toHaveText("Add a timeout");
  } finally {
    await page.evaluate(() => window.__threadVerification?.release?.());
    await opening;
  }
});

async function openCallSettings(page: Page) {
  await page.getByTestId("edge-call").dblclick();
  // Rename parks focus until the edge panel commits. Finish that work before opening another section.
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await waitForInteractionIdle(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect
    .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.call"]))
    .toEqual({ state: "loaded", active: true });
}

test("timeout setup waits for the call settings chunk to be ready", async ({ page }) => {
  const held = await holdChunk(page, chunk("CallWaitFields", "src/canvas/inspector/CallWaitFields.tsx"));
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d: waitingFixture(),
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  let ready = false;
  const opening = openCallSettings(page).then(() => {
    ready = true;
  });
  try {
    await expect
      .poll(() => page.evaluate(() => window.__lazySurfaces?.states()["inspector.call"]))
      .toEqual({ state: "loading", active: true });
    await expect(page.getByTestId("call-fields-loading")).toBeVisible();
    expect(ready).toBe(false);
  } finally {
    held.release();
    await opening;
  }
  await expect(page.getByTestId("inspector-field-deadlineMs")).toBeVisible();
});

test("Timeout validates whole milliseconds, bounds and clearing, and is undoable", async ({ page }) => {
  await page.clock.install();
  const d = waitingFixture();
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await gotoCanvas(page, "blocking-call");
  await waitForStableViewport(page);
  await openCallSettings(page);
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
    await openCallSettings(page);
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
  await openCallSettings(page);
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
    const d = timeoutFixture(disabled);
    await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
      key: STORAGE_KEYS.autosavePrefix + "blocking-call",
      d,
    });
    await verifiedTrouble(page);
    await expect(page.getByTestId("trouble-action")).toHaveText("Add a timeout");
    await page.getByTestId("trouble-action").click();
    await page.clock.runFor(400);
    await expect
      .poll(async () => {
        const saved = await savedDiagram(page);
        return saved.simulations?.[0].setup?.edges?.call.caller;
      })
      .toMatchObject({ deadlineMs: 600 });
    await page.getByTestId("undo-button").click();
    await page.clock.runFor(400);
    await expect
      .poll(async () => {
        const saved = await savedDiagram(page);
        return saved.simulations?.[0].setup?.edges?.call.caller;
      })
      .toEqual(disabled ? { deadlineMs: null } : undefined);
    if (disabled) expect((await savedDiagram(page)).edges[1].props?.caller).toEqual({ deadlineMs: 600 });
  });
}

test("simulation-only traffic withholds an unverified timeout and applies the next confirmed fix", async ({ page }) => {
  const d = waitingFixture();
  d.nodes[0].props = { ratePerSec: 0 };
  d.nodes[1].props = { ...d.nodes[1].props, concurrency: 100 };
  d.simulations = [
    {
      id: "slow",
      title: "Slow call",
      durationMs: 20000,
      traffic: [{ id: "traffic", node: "source", shape: { kind: "constant", ratePerSec: 120, durationMs: 20000 } }],
      timeline: [{ atMs: 0, action: { do: "fault", fault: { kind: "slow", node: "partner", factor: 10 } } }],
    },
  ];
  await page.addInitScript(({ key, d }) => localStorage.setItem(key, JSON.stringify(d)), {
    key: STORAGE_KEYS.autosavePrefix + "blocking-call",
    d,
  });
  await verifiedTrouble(page);
  const action = page.getByTestId("trouble-action");
  await expect(action).toHaveAttribute("data-action", "free-thread");
  await expect(action).toHaveText("Free the thread while waiting");
  await action.focus();
  await action.press("Enter");
  await page.clock.runFor(400);
  await expect
    .poll(async () => (await savedDiagram(page)).simulations?.[0].setup?.edges?.call.caller)
    .toEqual({ wait: "non-blocking" });
  expect((await savedDiagram(page)).edges[1].props?.caller).toBeUndefined();
});

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
      // The new status route can be doing local work in the last few slots.
      // Exhaustion concerns all busy threads, including those useful requests.
      expect(Number(await meter.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(98);
      expect(waiting).toBeGreaterThan(90);
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
      await openLiveNodeDetails(page, "checkout", "outcomes");
      await expect(page.getByTestId("node-outcome-checkout")).toContainText("all timed out after 0.6 s");
      await expect(page.getByTestId("node-outcome-checkout")).toContainText("late replies discarded");
      for (const mode of ["is-compact", "is-summary"]) {
        expect(
          await page.getByTestId("node-outcome-checkout").evaluate((element, mode) => {
            const detail = element.parentElement;
            if (!detail) return false;
            detail.classList.remove("is-compact", "is-summary");
            detail.classList.add(mode);
            return element.checkVisibility();
          }, mode),
        ).toBe(true);
        await expect(page.getByTestId("node-outcome-checkout")).toBeVisible();
        await expect(page.getByTestId("node-outcome-checkout")).toBeVisible();
      }
    }
  });
}
