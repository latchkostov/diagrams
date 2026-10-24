import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  gotoCanvas,
  gotoGallery,
  gotoLab,
  waitForStableBox,
  gotoLive,
  openLiveNodeDetails,
  STORAGE_KEYS,
} from "./fixtures";
import { installFakeModelContext } from "./ai-helpers";
import shapedLines from "../parity/corpus/hand-shaped-lines.diagram.json" with { type: "json" };

/**
 * Automated accessibility: axe-core (WCAG 2.0/2.1 A and AA rules) on each main view and overlay, in both
 * themes. Overlays are scanned on their own (the view behind them has its own test). Selectors are
 * data-testid only; axe's include/exclude take CSS, so they use [data-testid] attribute selectors.
 */
const KAFKA = "kafka-order-pipeline";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const MOD = "ControlOrMeta";
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
    name: "selected shaped edge",
    open: async (page) => {
      await page.addInitScript(({ key, diagram }) => localStorage.setItem(key, JSON.stringify(diagram)), {
        key: STORAGE_KEYS.autosavePrefix + KAFKA,
        diagram: shapedLines,
      });
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("node-api").click();
      // eslint-disable-next-line no-restricted-syntax -- Edge navigation uses literal Ctrl on every platform.
      await page.keyboard.press("Control+Alt+]");
      await expect(page.getByTestId(/^route-segment-/).first()).toBeVisible();
      await page.keyboard.press("]");
      await expect(page.getByTestId("edge-api-db")).toHaveAttribute("data-route", "custom");
    },
  },
  {
    name: "compact hover card",
    scope: "node-detail-caller",
    open: async (page) => {
      await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
      await page.getByTestId("node-caller").hover();
      await expect
        .poll(() => page.getByTestId("node-detail-caller").evaluate((el) => getComputedStyle(el).opacity))
        .toBe("1");
    },
  },
  {
    name: "problem hover card",
    scope: "node-detail-caller",
    open: async (page) => {
      await page.clock.install();
      await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&sim=blocking&paused=1");
      await page.getByTestId("live-play").click();
      await page.clock.runFor(5000);
      await page.getByTestId("live-play").click();
      await openLiveNodeDetails(page, "caller", "threads");
      await expect(page.getByTestId("hover-verdict")).toContainText("threads are busy");
      // The leading problem is the verdict; its meter stays in vitals instead of a duplicate attention row.
      await expect(page.getByTestId("hover-vitals")).toContainText("64/64");
      await expect(page.getByTestId("hover-attention-threads")).toHaveCount(0);
    },
  },
  {
    name: "pinned hover card",
    scope: "node-detail-caller",
    open: async (page) => {
      await gotoLive(page, "./?view=canvas&example=blocking-call&live=1&paused=1");
      await openLiveNodeDetails(page, "caller", "threads");
    },
  },
  {
    name: "colour picker",
    scope: "color-picker-modal",
    open: async (page) => {
      await gotoLab(page, "colour-picker");
      await page.getByTestId("colour-lab-open").click();
      await expect(page.getByTestId("color-picker-hex-input")).toBeFocused();
    },
  },
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
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&paused=1`);
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
      await waitForStableBox(node);
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
    // From the keyboard, with its public section open (every row scanned), one row with a file hint focused and another
    // hovered: the hint stays readable on the tinted row.
    name: "Share chooser",
    scope: "share-chooser",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("file-button").focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("file-menu")).toBeVisible();
      const share = page.getByTestId("file-share");
      for (let i = 0; i < 12 && !(await share.evaluate((el) => el === document.activeElement)); i++)
        await page.keyboard.press("ArrowDown");
      await expect(share).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("share-option-html")).toBeFocused();
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("share-option-embed-public")).toBeVisible();
      await page.keyboard.press("Home");
      await expect(page.getByTestId("share-option-html")).toBeFocused();
      await page.getByTestId("share-option-file").hover();
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
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&traffic=0&speed=8`);
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
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&speed=8`);
      await page.getByTestId("live-more").click();
      await page.getByTestId("live-trace-message").click();
      await page.getByTestId("live-trace-next").click();
      await expect(page.getByTestId("trace-card")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
      await page.getByTestId("trace-sequence").click();
      await expect(page.getByTestId("sequence-view")).toBeVisible();
    },
  },
  {
    name: "AI panel, idle, with WebMCP",
    scope: "ai-panel",
    open: async (page) => {
      await installFakeModelContext(page);
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("ai-rail-open").click();
      await expect(page.getByTestId("ai-howto")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("ai-tools-toggle").click();
      await expect(page.getByTestId("ai-tools-list")).toBeVisible();
    },
  },
  {
    name: "AI panel, idle, without WebMCP",
    scope: "ai-panel",
    open: async (page) => {
      await gotoCanvas(page, KAFKA);
      await page.getByTestId("ai-rail-open").click();
      await expect(page.getByTestId("ai-howto")).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: "Inputs & capacity panel",
    scope: "capacity-panel",
    open: async (page) => {
      await gotoLive(page, `./?view=canvas&example=${KAFKA}&live=1&paused=1&sim=black-friday`);
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
