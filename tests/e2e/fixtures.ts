import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

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
