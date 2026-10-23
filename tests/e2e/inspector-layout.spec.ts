import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { inspectorLayoutFixture } from "../../src/lab/inspectorLayoutFixture";
import { test, expect, gotoCanvas, waitForSelectionSettled } from "./fixtures";

async function open(page: Page, target = "edge-call", width = 1440, theme = "light", locale = "en", stencil?: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light", reducedMotion: "reduce" });
  const diagram = inspectorLayoutFixture();
  if (stencil) diagram.nodes[1].stencil = stencil;
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
  await page.getByTestId(target.startsWith("group-") ? target.replace("group-", "group-label-") : target).dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeVisible();
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

test("node identity is usable while Simulation fields download", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(/\/assets\/SimulationFields-[\w-]+\.js(?:\?.*)?$/, async (route) => {
    requested = true;
    await held;
    await route.continue();
  });
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

test("Simulation keeps 16px between complete fields, including their hints", async ({ page }) => {
  await open(page);
  await page.getByTestId("inspector-section-edge-simulation").click();
  const wait = page.getByTestId("inspector-unit-wait");
  const timeout = page.getByTestId("inspector-unit-deadlineMs");
  await expect(timeout).toBeVisible();
  await expect
    .poll(async () => {
      const a = await rect(wait),
        b = await rect(timeout);
      return b.y - a.y - a.height;
    })
    .toBe(16);
  await expect(wait.getByTestId("inspector-hint-wait")).toBeVisible();
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
  expect(gap).toBe(6);
});

test("collapsed Simulation and Advanced describe the same values as their fields", async ({ page }) => {
  await open(page);
  const summary = page.getByTestId("inspector-summary-edge-simulation");
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
  test(`short fields ${width === 1440 ? "pair" : "stack"} at ${width}px`, async ({ page }) => {
    await open(page, "edge-call", width);
    await page.getByTestId("inspector-section-edge-simulation").click();
    await page.getByTestId("inspector-section-retry-details").click();
    const backoff = page.getByTestId("inspector-unit-retry-backoff");
    const growth = page.getByTestId("inspector-unit-retry-growth");
    await expect(growth).toBeVisible();
    const a = await rect(backoff),
      b = await rect(growth);
    if (width === 1440) {
      expect(b.y).toBe(a.y);
      expect(b.x - a.x - a.width).toBe(16);
    } else {
      expect(b.x).toBe(a.x);
      expect(b.y - a.y - a.height).toBe(16);
    }
    const fieldset = page.getByTestId("inspector-field-retry-timeout").evaluate((el) => {
      const fieldset = el.closest("fieldset");
      return {
        legend: fieldset?.firstElementChild?.textContent,
        columns:
          fieldset && getComputedStyle(fieldset.lastElementChild ?? fieldset).gridTemplateColumns.split(" ").length,
      };
    });
    expect(await fieldset).toEqual({ legend: "Retry on", columns: width === 1440 ? 2 : 1 });
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
    await expect(page.getByTestId("planning-capacity-formula")).toBeVisible();
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
    expect(rule).toEqual({ start: "2px", end: "0px", direction: locale === "ar" ? "rtl" : "ltr" });
    expect(
      await page
        .getByTestId("inspector-section-retry-details")
        .evaluate((el) => getComputedStyle(el.lastElementChild ?? el).transform),
    ).toBe("matrix(0, 1, -1, 0, 0, 0)");
  });
}
