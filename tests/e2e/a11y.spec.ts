import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoGallery, gotoLab } from "./fixtures";

/**
 * Automated accessibility: axe-core (WCAG 2.0/2.1 A and AA rules) on each main view and overlay, in both
 * themes. Overlays are scanned on their own (the view behind them has its own test). Selectors are
 * data-testid only; axe's include/exclude take CSS, so they use [data-testid] attribute selectors.
 */
const KAFKA = "kafka-order-pipeline";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const tid = (id: string) => `[data-testid="${id}"]`;

async function expectNoViolations(page: Page, scope?: string) {
  let axe = new AxeBuilder({ page }).withTags(WCAG);
  if (scope) axe = axe.include(tid(scope));
  const { violations } = await axe.analyze();
  const report = violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes.map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.replace(/\n/g, "\n      ")}`).join("\n"),
  );
  expect(report, report.join("\n")).toEqual([]);
}

/** Each view or overlay: how to reach it, and the test id to scan (the whole page when omitted). */
const states: { name: string; open: (page: Page) => Promise<void>; scope?: string }[] = [
  {
    name: "stencils",
    open: async (page) => {
      await gotoGallery(page);
      await expect(page.getByTestId(/^stencil-tile-/).first()).toBeVisible();
    },
  },
  {
    name: "diagram",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await expect(page.getByTestId("node-payments")).toBeVisible();
    },
  },
  {
    name: "live mode",
    open: async (page) => {
      await page.goto(`./?view=canvas&example=${KAFKA}&live=1&paused=1`);
      await expect(page.getByTestId("live-controls")).toBeVisible();
    },
  },
  {
    name: "presentation",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("present-toggle").click();
      await expect(page.getByTestId("present-exit")).toBeVisible();
    },
  },
  {
    name: "Lab",
    open: async (page) => {
      await gotoLab(page);
      await expect(page.getByTestId("lab-stage")).toBeVisible();
    },
  },
  {
    name: "command palette",
    scope: "command-palette",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.keyboard.press(`${MOD}+k`);
      await expect(page.getByTestId("command-input")).toBeFocused();
    },
  },
  {
    name: "File menu",
    scope: "file-menu",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("file-button").click();
      await expect(page.getByTestId("file-menu")).toBeVisible();
    },
  },
  {
    name: "context menu",
    scope: "context-menu",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      // The opening fit moves the viewport, and a viewport move closes menus: wait for the node to hold
      // still, and retry in case a late fit still closed it.
      const node = page.getByTestId("node-payments");
      let last = "";
      await expect
        .poll(
          async () => {
            const now = JSON.stringify(await node.boundingBox());
            const still = now === last;
            last = now;
            return still;
          },
          { intervals: [100, 150, 150, 250] },
        )
        .toBe(true);
      await expect(async () => {
        await node.click({ button: "right" });
        await expect(page.getByTestId("context-menu")).toBeVisible({ timeout: 1000 });
      }).toPass();
    },
  },
  {
    name: "inspector",
    scope: "inspector",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("node-payments").click();
      await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
      await expect(page.getByTestId("inspector-title")).toBeVisible();
    },
  },
  {
    name: "library dialog",
    scope: "library-dialog",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-library").click();
      await expect(page.getByTestId("library-dialog")).toBeVisible();
    },
  },
  {
    name: "trace card",
    scope: "trace-card",
    open: async (page) => {
      await page.goto(`./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=8`);
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-trace-message").click();
      await page.getByTestId("live-trace-next").click();
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-traffic").click();
      await expect(page.getByTestId("trace-card")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
    },
  },
  {
    name: "sequence dialog",
    scope: "sequence-dialog",
    open: async (page) => {
      await page.goto(`./?view=canvas&example=${KAFKA}&live=1&speed=8`);
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-trace-message").click();
      await page.getByTestId("live-trace-next").click();
      await expect(page.getByTestId("trace-card")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
      await page.getByTestId("trace-sequence").click();
      await expect(page.getByTestId("sequence-view")).toBeVisible();
    },
  },
  {
    name: "Inputs & capacity panel",
    scope: "capacity-panel",
    open: async (page) => {
      await page.goto(`./?view=canvas&example=${KAFKA}&live=1&paused=1&sim=black-friday`);
      await page.getByTestId("live-capacity").click();
      await expect(page.getByTestId("capacity-rate-shopper")).toBeVisible();
    },
  },
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`a11y (${theme})`, () => {
    // The saved-theme script in index.html follows prefers-color-scheme when nothing is saved.
    // Reduced motion: scan settled colours, not a fade-in midway.
    test.use({ colorScheme: theme, reducedMotion: "reduce" });

    for (const s of states) {
      test(s.name, async ({ page }) => {
        await s.open(page);
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        await expectNoViolations(page, s.scope);
      });
    }
  });
}
