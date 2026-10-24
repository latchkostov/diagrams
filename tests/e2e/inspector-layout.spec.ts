import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import type { DiagramFile } from "../../src/model/types";
import type { EdgeSimProps } from "../../src/sim/types";
import { inspectorLayoutFixture } from "../../src/lab/inspectorLayoutFixture";
import { test, expect, gotoCanvas, waitForSelectionSettled, savedDiagram, pauseClock } from "./fixtures";

async function open(
  page: Page,
  target = "edge-call",
  width = 1440,
  theme = "light",
  locale = "en",
  stencil?: string,
  rates = false,
  firewall = false,
  customize?: (diagram: DiagramFile) => void,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light", reducedMotion: "reduce" });
  const diagram = inspectorLayoutFixture();
  if (firewall) diagram.nodes[1].stencil = "generic.firewall";
  if (stencil) diagram.nodes[1].stencil = stencil;
  if (rates) {
    diagram.planning = {
      ...diagram.planning,
      revision: "p3-w2",
      requestRoutes: [
        { id: "browse", address: { method: "GET", path: "/browse" } },
        { id: "checkout", address: { method: "POST", path: "/checkout" } },
      ],
    };
    diagram.nodes[0].props = {
      ratePerSec: 999,
      trafficMix: {
        mode: "rates",
        entries: [
          { routeId: "browse", ratePerSec: 12 },
          { routeId: "checkout", ratePerSec: 18 },
        ],
      },
    };
  }
  customize?.(diagram);
  await page.addInitScript(
    ({ diagram, theme, locale }) => {
      localStorage.setItem("diagrams.settings.v1", JSON.stringify({ theme }));
      localStorage.setItem("diagrams.locale", locale);
      localStorage.setItem("diagrams.inspector.open.v1", "{}");
      localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", JSON.stringify(diagram));
    },
    { diagram, theme, locale },
  );
  await gotoCanvas(page, "kafka-order-pipeline");
  if (target) {
    await page.getByTestId(target.startsWith("group-") ? target.replace("group-", "group-label-") : target).dblclick();
    await expect(page.getByTestId("inspector-field-label")).toBeVisible();
  } else if ((await page.getByTestId("inspector").getAttribute("data-collapsed")) === "1") {
    await page.getByTestId("inspector-toggle").click();
  }
  await waitForSelectionSettled(page);
}

for (const stencil of [
  "generic.service",
  "postgres",
  "generic.queue",
  "kafka.topic",
  "azure.service-bus.queue",
  "redis.cache",
  "generic.adc",
  "client.user",
  "generic.external-api",
  "aws.lambda",
  "k8s.pod",
  "generic.file",
  "cisco.isr",
]) {
  test(`Simulation summary renders for ${stencil}`, async ({ page }) => {
    await open(page, "node-caller", 1440, "light", "en", stencil);
    const summary = page.getByTestId("inspector-summary-node-simulation");
    await expect(summary).not.toBeEmpty();
    await page.getByTestId("inspector-section-node-simulation").click();
    if (stencil === "aws.lambda" || stencil === "generic.external-api") {
      if (stencil === "generic.external-api")
        await expect(page.getByTestId("planning-arithmetic").getByTestId("readout-facts")).toContainText("Unknown");
      const field = page.getByTestId(stencil === "aws.lambda" ? "admission-allocation" : "admission-rate");
      await expect(field).toBeVisible();
      const value = await field.inputValue();
      await page.getByTestId("inspector-section-node-simulation").click();
      if (value) await expect(summary).toContainText(new Intl.NumberFormat("en").format(Number(value)));
    }
  });
}

async function rect(locator: Locator) {
  return locator.evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
}

async function expectCompleteSegments(page: Page, testId: string, singleLine = false, fullColumn = true) {
  const group = page.getByTestId(testId);
  await expect(group).toBeVisible();
  const metrics = await group.evaluate((el) => {
    const field = el.parentElement;
    if (!field) throw new Error("Missing segmented field");
    const columns = getComputedStyle(field).gridTemplateColumns.split(" ");
    return {
      width: el.getBoundingClientRect().width,
      available: Number.parseFloat(columns.at(-1) ?? ""),
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
  if (fullColumn) expect(metrics.width).toBeCloseTo(metrics.available, 0);
  expect(metrics.overflow).toBe(0);
  for (const segment of await group.getByTestId(new RegExp(`^${testId}-.+`)).all()) {
    const text = await segment.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const style = getComputedStyle(el);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      return {
        overflowX: el.scrollWidth - el.clientWidth,
        overflowY: el.scrollHeight - el.clientHeight,
        lines: Math.round(range.getBoundingClientRect().height / lineHeight),
      };
    });
    expect(text.overflowX).toBe(0);
    expect(text.overflowY).toBe(0);
    expect(text.lines).toBeGreaterThan(0);
    expect(text.lines).toBeLessThanOrEqual(singleLine ? 1 : 2);
  }
}

for (const width of [1280, 1440]) {
  for (const locale of ["en", "en-XA", "ar"]) {
    test(`segmented labels remain complete at ${width}px in ${locale}`, async ({ page }, testInfo) => {
      await open(page, "edge-call", width, "light", locale);
      await page.getByTestId("inspector-section-edge-simulation").click();
      await expectCompleteSegments(page, "inspector-field-wait", locale === "en");
      await expectCompleteSegments(page, "inspector-field-breaker");
      await page.screenshot({ path: testInfo.outputPath(`impl-H-request-sim-${width}-${locale}.png`) });
      await page.getByTestId("inspector-section-retry-details").click();
      await expectCompleteSegments(page, "inspector-field-retry-growth");
      await expectCompleteSegments(page, "inspector-field-retry-jitter");

      await page.getByTestId("node-caller").dblclick();
      await waitForSelectionSettled(page);
      await page.getByTestId("inspector-section-node-simulation").click();
      await expect(page.getByTestId("inspector-field-concurrency")).toBeVisible();
      await page
        .getByTestId("inspector-section-node-simulation")
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: testInfo.outputPath(`impl-H-service-sim-${width}-${locale}.png`) });
      await page.getByTestId("autoscaling-preset").selectOption("hpa-service");
      await page.getByTestId("autoscaling-advanced-toggle").click();
      await page.getByTestId("autoscaling-metric").selectOption("busyThreads");
      // This compact unit selector shares its input rather than occupying a ledger row.
      await expectCompleteSegments(page, "autoscaling-busy-unit", true, false);

      // The diagram and annotation choices share the same value-column treatment.
      await open(page, "", width, "light", locale);
      await expectCompleteSegments(page, "inspector-field-direction");
      if (!(await page.getByTestId("palette-annotate-note").isVisible())) {
        await page.getByTestId("palette-toggle").click();
      }
      await page.getByTestId("palette-annotate-note").click();
      await page.keyboard.press("Escape");
      await expectCompleteSegments(page, "inspector-field-text-size");

      await open(page, "node-source", width, "light", locale, undefined, true);
      await page.getByTestId("inspector-section-node-simulation").click();
      await expectCompleteSegments(page, "mix-mode");

      await open(page, "edge-call", width, "light", locale, undefined, false, true);
      await expectCompleteSegments(page, "inspector-field-rule");
      expect(await page.getByTestId("inspector-body").evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  }
}

test("reselecting breaker On preserves tuned settings and Undo history", async ({ page }) => {
  await page.clock.install();
  await open(page);
  await pauseClock(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  const on = page.getByTestId("inspector-field-breaker-on");
  await on.click();
  await page.clock.runFor(1000);
  await page.getByTestId("inspector-section-breaker-details").click();
  const failure = page.getByTestId("inspector-field-breaker-failurePercent");
  const minimum = page.getByTestId("inspector-field-breaker-minimumCalls");
  const duration = page.getByTestId("inspector-field-breaker-openMs");
  const breaker = async () =>
    ((await savedDiagram(page)).edges.find((edge) => edge.id === "call")?.props?.caller as EdgeSimProps["caller"])
      ?.breaker;
  // Advance the fake clock past history/autosave debounces between distinct edits.
  await failure.fill("35");
  await page.clock.runFor(1000);
  await expect.poll(breaker).toEqual({ failurePercent: 35 });
  await minimum.fill("12");
  await page.clock.runFor(1000);
  await expect.poll(breaker).toEqual({ failurePercent: 35, minimumCalls: 12 });
  await duration.fill("7000");
  await page.clock.runFor(1000);
  await expect.poll(breaker).toEqual({ failurePercent: 35, minimumCalls: 12, openMs: 7000 });
  await on.click();
  await on.press("End");
  await page.clock.runFor(1000);
  await expect(failure).toHaveValue("35");
  await expect(minimum).toHaveValue("12");
  await expect(duration).toHaveValue("7000");
  await expect.poll(breaker).toEqual({ failurePercent: 35, minimumCalls: 12, openMs: 7000 });
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(1000);
  await expect.poll(breaker).toEqual({ failurePercent: 35, minimumCalls: 12 });
  // A redundant selection must also preserve the redo branch.
  await on.click();
  await on.press("End");
  await page.clock.runFor(1000);
  await expect(page.getByTestId("redo-button")).toBeEnabled();
  await page.getByTestId("redo-button").click();
  await page.clock.runFor(1000);
  await expect.poll(breaker).toEqual({ failurePercent: 35, minimumCalls: 12, openMs: 7000 });
});

test("retry segments persist selections and preserve custom policies", async ({ page }) => {
  await page.clock.install();
  await open(page, "edge-call", 1440, "light", "en", undefined, false, false, (diagram) => {
    const caller = diagram.edges.find((edge) => edge.id === "call")?.props?.caller as EdgeSimProps["caller"];
    if (!caller?.retry) throw new Error("Missing fixture retry policy");
    caller.retry = {
      ...caller.retry,
      jitter: 0.3,
      maxBackoffMs: 900,
      idempotent: true,
      budget: { percent: 17, minPerSec: 4 },
    };
  });
  await pauseClock(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-section-retry-details").click();
  await expect(page.getByTestId("inspector-field-retry-jitter-0.3")).toHaveAttribute("aria-checked", "true");
  const retry = async () =>
    ((await savedDiagram(page)).edges.find((edge) => edge.id === "call")?.props?.caller as EdgeSimProps["caller"])
      ?.retry;
  const original = await retry();
  await page.getByTestId("inspector-field-retry-growth-fixed").click();
  await page.clock.runFor(1000);
  await expect.poll(retry).toEqual({ ...original, strategy: "fixed" });
  await page.getByTestId("inspector-field-retry-jitter-0.5").click();
  await page.clock.runFor(1000);
  await expect.poll(retry).toEqual({ ...original, strategy: "fixed", jitter: 0.5 });
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(1000);
  await expect.poll(retry).toEqual({ ...original, strategy: "fixed" });
  await expect(page.getByTestId("inspector-field-retry-jitter-0.3")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("undo-button").click();
  await page.clock.runFor(1000);
  await expect.poll(retry).toEqual(original);
  await expect(page.getByTestId("inspector-field-retry-growth-exponential")).toHaveAttribute("aria-checked", "true");
});

test("node identity is usable while Simulation fields download", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(
    /\/(?:assets\/SimulationFields-[\w-]+\.js|src\/canvas\/inspector\/SimulationFields\.tsx)(?:\?.*)?$/,
    async (route) => {
      requested = true;
      await held;
      await route.continue();
    },
  );
  try {
    await open(page, "node-caller");
    await expect.poll(() => requested).toBe(true);
    const label = page.getByTestId("inspector-field-label");
    await label.fill("Orders service");
    await expect(label).toBeFocused();
    release();
    await expect(page.getByTestId("inspector-summary-node-simulation")).toBeVisible();
    await expect(label).toHaveValue("Orders service");
    await expect(label).toBeFocused();
  } finally {
    release();
  }
});

test("Simulation preserves complete-field spacing and shows the pool explanation once", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-section-call-advanced").click();
  const pool = page.getByTestId("inspector-unit-poolConnections");
  const reply = page.getByTestId("inspector-unit-replyMs");
  const timeout = page.getByTestId("inspector-unit-deadlineMs");
  await expect(reply).toBeVisible();
  await expect
    .poll(async () => {
      const a = await rect(pool),
        b = await rect(reply);
      return b.y - a.y - a.height;
    })
    .toBe(16);
  await expect(page.getByTestId("inspector-hint-poolConnections")).toHaveCount(0);
  await expect(page.getByTestId("inspector-content-call-advanced")).toContainText("Maximum calls in flight.");
  await expect(timeout.getByTestId("inspector-hint-deadlineMs")).toBeVisible();
  await expect(page.getByTestId("inspector-field-deadlineMs")).toHaveAccessibleName("Timeout ms");
  await expect(page.getByTestId("inspector-field-deadlineMs")).toHaveAccessibleDescription(
    await timeout.getByTestId("inspector-hint-deadlineMs").innerText(),
  );
  const gap = await timeout.getByTestId("inspector-hint-deadlineMs").evaluate((hint) => {
    const control = hint.previousElementSibling;
    if (!control) throw new Error("Missing field control");
    return hint.getBoundingClientRect().top - control.getBoundingClientRect().bottom;
  });
  expect(gap).toBe(4);
});

test("collapsed Simulation and Advanced describe the same values as their fields", async ({ page }) => {
  await open(page);
  const summary = page.getByTestId("inspector-summary-edge-simulation");
  await expect(
    page.getByTestId("inspector-section-edge-simulation").getByTestId("inspector-summary-edge-simulation"),
  ).toBeVisible();
  await expect(summary).toHaveText("Frees the thread · 300 ms timeout · 3 attempts");
  await expect(page.getByTestId("inspector-section-edge-simulation")).toHaveAttribute(
    "aria-describedby",
    (await summary.getAttribute("id")) as string,
  );
  await expect(page.getByTestId("inspector-summary-edge-advanced")).toHaveText("Auto → Auto · 10 ms travel");
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-field-deadlineMs").fill("450");
  await page.getByTestId("inspector-section-edge-simulation").click();
  await expect(summary).toContainText("450 ms timeout");
  await page.getByTestId("node-caller").dblclick();
  await expect(page.getByTestId("inspector-summary-node-simulation")).toHaveText("4 replicas × 100 slots");
});

for (const width of [1440, 1000]) {
  test(`ledger fields and checkbox choices stay in one column at ${width}px`, async ({ page }) => {
    await open(page, "edge-call", width);
    await page.getByTestId("inspector-section-edge-simulation").click();
    await expect(page.getByTestId("inspector-summary-retry-details")).toHaveText("100 ms backoff · Exponential (×2)");
    await page.getByTestId("inspector-section-retry-details").click();
    const backoff = page.getByTestId("inspector-unit-retry-backoff");
    const growth = page.getByTestId("inspector-unit-retry-growth");
    await expect(growth).toBeVisible();
    const a = await rect(backoff),
      b = await rect(growth);
    expect(b.x).toBe(a.x);
    // Below 330 px the sheet keeps the original stacked-field rhythm.
    expect(b.y - a.y - a.height).toBe(width === 1440 ? 10 : 16);
    await page.getByTestId("inspector-section-retry-safety").click();
    const fieldset = page.getByTestId("inspector-field-retry-timeout").evaluate((el) => {
      const fieldset = el.closest("fieldset");
      return {
        legend: fieldset?.firstElementChild?.textContent,
        columns:
          fieldset && getComputedStyle(fieldset.lastElementChild ?? fieldset).gridTemplateColumns.split(" ").length,
      };
    });
    expect(await fieldset).toEqual({ legend: "Retry on", columns: 1 });
  });
}

for (const theme of ["light", "dark"]) {
  for (const target of ["node-caller", "edge-call", "group-commerce"]) {
    test(`axe Inspector ${target} in ${theme}`, async ({ page }) => {
      await open(page, target, 1440, theme);
      if (target !== "group-commerce") {
        await page.getByTestId(`inspector-section-${target === "edge-call" ? "edge" : "node"}-simulation`).click();
        if (target === "edge-call") await page.getByTestId("inspector-section-retry-details").click();
      }
      const result = await new AxeBuilder({ page })
        .include('[data-testid="inspector"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(result.violations).toEqual([]);
    });
  }
}

for (const locale of ["ar", "en-XA"]) {
  test(`narrow node facts and formulas wrap inside the sheet in ${locale}`, async ({ page }) => {
    await open(page, "node-caller", 1000, "light", locale);
    const formula = page.getByTestId("planning-capacity-formula");
    await expect(formula).toBeVisible();
    expect(await formula.evaluate((el) => el.firstElementChild?.tagName)).toBe("BDI");
    expect(
      await page
        .getByTestId("planning-arithmetic")
        .getByTestId("readout-facts")
        .evaluate((list) => [...list.children].filter((row) => (row as HTMLElement).dataset.key === "capacity").length),
    ).toBe(1);
    expect(await page.getByTestId("inspector-body").evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    const header = page.getByTestId("inspector-section-node-simulation");
    expect(await header.evaluate((el) => getComputedStyle(el).paddingInlineStart)).toBe("16px");
  });
  test(`Inspector groups align and long labels stay inside the sheet in ${locale}`, async ({ page }) => {
    await open(page, "edge-call", 1280, "light", locale);
    await page.getByTestId("inspector-section-edge-simulation").click();
    await page.getByTestId("inspector-section-retry-details").click();
    const overflow = await page.getByTestId("inspector-body").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);
    const rule = await page.getByTestId("inspector-section-retry-details").evaluate((el) => {
      const section = el.parentElement?.parentElement;
      if (!section) throw new Error("Missing subgroup section");
      const style = getComputedStyle(section);
      return { start: style.borderInlineStartWidth, end: style.borderInlineEndWidth, direction: style.direction };
    });
    expect(rule).toEqual({ start: "0px", end: "0px", direction: locale === "ar" ? "rtl" : "ltr" });
    expect(
      await page
        .getByTestId("inspector-section-retry-details")
        .evaluate((el) => getComputedStyle(el.lastElementChild ?? el).transform),
    ).toBe("matrix(0, 1, -1, 0, 0, 0)");
  });
}

test("rates-mode source summary uses the effective traffic total", async ({ page }) => {
  await open(page, "node-source", 1440, "light", "en", undefined, true);
  await expect(page.getByTestId("inspector-summary-node-simulation")).toHaveText("30 msg/s");
});

test("segments keep one Tab stop and change the saved policy with arrow, Home and End keys", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  const frees = page.getByTestId("inspector-field-wait-non-blocking");
  const holds = page.getByTestId("inspector-field-wait-blocking");
  await frees.focus();
  await frees.press("Home");
  await expect(holds).toBeFocused();
  await expect(holds).toHaveAttribute("aria-checked", "true");
  await expect(holds).toHaveAttribute("tabindex", "0");
  await expect(frees).toHaveAttribute("tabindex", "-1");
  await holds.press("End");
  await expect(frees).toBeFocused();
  await frees.press("ArrowLeft");
  await expect(holds).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => (await savedDiagram(page)).edges.find((edge) => edge.id === "call")?.props?.caller)
    .toMatchObject({ wait: "blocking" });
  await holds.press("Tab");
  await expect(page.getByTestId("inspector-field-deadlineMs")).toBeFocused();
});

test("closed readout disclosures show their summary in the row and hide it when opened", async ({ page }) => {
  await open(page, "node-caller");
  await page.getByTestId("inspector-section-node-simulation").click();
  await page.getByTestId("autoscaling-preset").selectOption("cloud-ecs-cpu");
  const summary = page.getByTestId("autoscaling-advanced-summary");
  await expect(summary).toBeVisible();
  const toggle = page.getByTestId("autoscaling-advanced-toggle");
  await expect(toggle.getByTestId("autoscaling-advanced-summary")).toBeVisible();
  await expect(toggle).toHaveAccessibleName("Advanced");
  await expect(toggle).toHaveAccessibleDescription(await summary.innerText());
  await toggle.click();
  await expect(summary).toBeHidden();
});

test("focused fields stay below their pinned section band", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  await page.getByTestId("inspector-field-breaker-on").click();
  await page.getByTestId("inspector-section-breaker-details").click();
  const field = page.getByTestId("inspector-field-breaker-slowPercent");
  await field.focus();
  await expect(field).toBeFocused();
  await expect
    .poll(async () => {
      const band = await rect(page.getByTestId("inspector-section-edge-simulation"));
      const input = await rect(field);
      return input.y >= band.y + band.height;
    })
    .toBe(true);
});
