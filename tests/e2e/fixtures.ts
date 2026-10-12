import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared helpers for every e2e spec. Selectors are data-testid only (owner's rule):
 * use page.getByTestId(...) and scope with .getByTestId(...) — never classes or ids.
 *
 * Each test runs in a fresh browser context, so localStorage starts empty. The keys the app
 * persists are listed in STORAGE_KEYS in case a test needs to seed or inspect them.
 */
export const STORAGE_KEYS = {
  settings: "diagrams.settings.v1",
  autosavePrefix: "diagrams.autosave.v1:",
  /** Your diagrams: the index (documents live under diagrams.doc.v1:<id>). */
  library: "diagrams.library.v1",
  /** The single "Your diagram" slot from before the library (still read, in place). */
  imported: "diagrams.imported.v1",
  paletteCollapsed: "diagrams.paletteCollapsed.v1",
  labCustom: "diagrams.lab.custom.v1",
} as const;

export interface PublicExample {
  slug: string;
  title: string;
  nodeIds: string[];
  edgeIds: string[];
}

/** The public examples (src/examples/*.json — never src/examples/private). */
export const publicExamples: PublicExample[] = (() => {
  const dir = join(process.cwd(), "src", "examples");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8")) as {
        title: string;
        nodes: { id: string }[];
        edges: { id: string }[];
      };
      return {
        slug: f.slice(0, -".json".length),
        title: d.title,
        nodeIds: d.nodes.map((n) => n.id),
        edgeIds: d.edges.map((e) => e.id),
      };
    });
})();

declare global {
  interface Window {
    /** Dev and e2e builds: RGBA pixels of a live canvas layer inside a client rect (src/live/LiveView.tsx). */
    __liveProbe?: (
      layer: "base" | "over" | "march",
      rect: { x: number; y: number; width: number; height: number },
    ) => Promise<Uint8ClampedArray>;
  }
}

/**
 * Painted pixels (alpha above `threshold`) of a live canvas layer inside a client rect, wherever the
 * layer is drawn: an OffscreenCanvas in the particle worker can't be read from the page, so this asks
 * the renderer (the `__liveProbe` hook of dev and e2e builds). The whole pane when `rect` is omitted.
 */
export async function livePaint(
  page: Page,
  layer: "base" | "over" | "march",
  rect?: { x: number; y: number; width: number; height: number },
  threshold = 40,
): Promise<number> {
  return page.evaluate(
    async ([layer, rect, threshold]) => {
      const probe = window.__liveProbe;
      if (!probe) throw new Error("no __liveProbe: live view isn't on, or this build has no test hooks");
      const el = document.querySelector('[data-testid="live-canvas"]');
      if (!el) throw new Error("no live canvas");
      const pane = el.getBoundingClientRect();
      const data = await probe(layer, rect ?? { x: pane.left, y: pane.top, width: pane.width, height: pane.height });
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > threshold) n++;
      return n;
    },
    [layer, rect ?? null, threshold] as const,
  );
}

/** Console noise that isn't an app error. Keep this list short and specific. */
const IGNORED_CONSOLE = [/Download the React DevTools/i, /\[vite\]/i];

type Fixtures = {
  /** Console errors + uncaught page errors collected during the test. Assert it's empty with expectNoErrors. */
  consoleErrors: string[];
};

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (!IGNORED_CONSOLE.some((r) => r.test(text))) errors.push(`console.error: ${text}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
  },
});

export { expect };

/**
 * What the app server is (the same rule as playwright.config.ts): "build" serves the production e2e build
 * (tests/.output/e2e-dist), "dev" the Vite dev server. An explicit E2E_TARGET wins, on CI too.
 */
export const E2E_TARGET = process.env.E2E_TARGET ?? (process.env.CI ? "build" : "dev");

/**
 * Polls `read` until two readings in a row are equal: an animation, a fit or a pan has finished. An empty
 * reading (nothing to measure) never counts as settled, so a missing element fails instead of passing.
 */
async function waitForStable(read: () => Promise<string>) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await read();
        const still = now !== "" && now === last;
        last = now;
        return still;
      },
      { intervals: [100, 150, 150, 250] },
    )
    .toBe(true);
}

/**
 * Waits until an element's box holds still. Viewport moves (the opening fit, a refit, a pan clear of the
 * inspector) close menus and shift what a test measures: wait for this first.
 */
export function waitForStableBox(locator: Locator) {
  return waitForStable(async () => {
    const box = await locator.boundingBox();
    return box ? JSON.stringify(box) : "";
  });
}

/** Waits until the canvas viewport's transform holds still (a fit, a pan or its momentum has finished). */
export function waitForStableViewport(page: Page) {
  return waitForStable(() => viewportTransform(page));
}

/** The canvas viewport's CSS transform (React Flow's pan and zoom). */
export const viewportTransform = (page: Page) =>
  page
    .getByTestId("canvas-wrap")
    .evaluate((wrap) => wrap.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "");

export function expectNoErrors(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}

export async function gotoGallery(page: Page) {
  await page.goto("./?view=gallery");
  await expect(page.getByTestId("gallery-view")).toBeVisible();
}

export async function gotoCanvas(page: Page, slug: string) {
  await page.goto(`./?view=canvas&example=${encodeURIComponent(slug)}`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
}

export type LabControls = Record<string, string | number | boolean>;

/** Opens the Lab on a preset, with optional control overrides (applied from the URL). */
export async function gotoLab(page: Page, preset?: string, controls: LabControls = {}) {
  const p = new URLSearchParams({ view: "lab" });
  if (preset) p.set("preset", preset);
  for (const [k, v] of Object.entries(controls)) p.set(k, String(v));
  await page.goto(`./?${p}`);
  await expect(page.getByTestId("lab-view")).toBeVisible();
  if (preset) await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", preset);
}

/** All preset ids, read from the Lab's sidebar (data-testid="lab-preset-link-<id>"). */
export async function labPresetIds(page: Page): Promise<string[]> {
  await gotoLab(page);
  const links = page.getByTestId(/^lab-preset-link-/);
  await expect(links.first()).toBeVisible();
  const ids = await links.evaluateAll((els) =>
    els.map((el) => {
      const id = el.getAttribute("data-testid");
      if (!id) throw new Error("Preset link has no test id");
      return id.slice("lab-preset-link-".length);
    }),
  );
  return ids;
}
