import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type FrameLocator, type Locator, type Page } from "@playwright/test";
import type { DiagramFile } from "../../src/model/types";
import { pauseClocks } from "../../scripts/e2e-clock";
import { textBoundaryKey } from "../../scripts/e2e-keys";
import { withSlowmoDiagnostic, slowmoDiagnosticEnabled, slowmoDiagnosticTest } from "./slowmo-diagnostic";

export const TEXT_START = textBoundaryKey("start");
export const TEXT_END = textBoundaryKey("end");

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

/** Persisted content follows the picker into an owned copy; source keys are only for seeding. */
export async function savedDiagram(page: Page): Promise<DiagramFile> {
  let diagram: DiagramFile | undefined;
  // Wait for persistence and the picker to publish the current document.
  await expect
    .poll(
      async () => {
        diagram = await page.getByTestId("example-picker").evaluate((picker, prefix) => {
          const current = picker.getAttribute("data-diagram-slug");
          if (!current) return undefined;
          const originalKey = current.startsWith("my-")
            ? "diagrams.doc.v1:" + current.slice(3)
            : current === "imported"
              ? "diagrams.imported.v1"
              : current === "shared"
                ? "diagrams.shared.v1"
                : undefined;
          const raw =
            localStorage.getItem(prefix + current) ?? (originalKey ? localStorage.getItem(originalKey) : null);
          const parsed = raw ? JSON.parse(raw) : undefined;
          return parsed?.sessionFormat === "diagrams/session/v1" ? parsed.diagram : parsed;
        }, STORAGE_KEYS.autosavePrefix);
        return !!diagram && Array.isArray(diagram.nodes);
      },
      { message: "Expected a persisted diagram for the currently open document" },
    )
    .toBe(true);
  if (!diagram) throw new Error("Expected a persisted diagram for the currently open document");
  return diagram;
}

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

/** Public-card assertions stay valid when the development catalog adds local entries. */
export const publicExampleCards = (page: Page) =>
  page.getByTestId(new RegExp(`^example-card-(${publicExamples.map((e) => e.slug).join("|")})$`));

declare global {
  interface Window {
    /** Dev and e2e builds: RGBA pixels of a live canvas layer inside a client rect (src/live/LiveView.tsx). */
    __liveProbe?: (
      layer: "base" | "over" | "march",
      rect: { x: number; y: number; width: number; height: number },
    ) => Promise<{ data: Uint8ClampedArray; width: number; height: number; x: number; y: number; scale: number }>;
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
      const { data } = await probe(
        layer,
        rect ?? { x: pane.left, y: pane.top, width: pane.width, height: pane.height },
      );
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
  /** A Vite reload aborts in-flight actions; report the cause instead of a missing control. */
  devReloads: undefined;
  /** Console errors + uncaught page errors collected during the test. Assert it's empty with expectNoErrors. */
  consoleErrors: string[];
};

const sharedTest = (slowmoDiagnosticEnabled() ? slowmoDiagnosticTest : base).extend<Fixtures>({
  devReloads: [
    async ({ context }, use) => {
      const reloads: string[] = [];
      const watch = (page: Page) => {
        page.on("websocket", (socket) => {
          socket.on("framereceived", ({ payload }) => {
            let message: { type?: string; path?: string };
            try {
              message = JSON.parse(String(payload)) as typeof message;
            } catch {
              return;
            }
            if (message.type !== "full-reload") return;
            const path = new URL(page.url()).pathname;
            // Vite sends HTML changes to every page, but reloads only the matching document.
            if (
              !message.path?.endsWith(".html") ||
              message.path === "/index.html" ||
              message.path === path ||
              `${path}index.html` === message.path
            )
              reloads.push(`${page.url()}: ${String(payload)}`);
          });
        });
      };
      for (const page of context.pages()) watch(page);
      context.on("page", watch);
      await use(undefined);
      expect(
        reloads,
        "Vite reloaded a test page mid-test (dependency optimization or HMR); see dev-server stdout",
      ).toEqual([]);
    },
    { auto: true },
  ],
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
export const test = withSlowmoDiagnostic(sharedTest);

/** DOM snapshots of the stress diagrams are test instrumentation, not application input work. */
export const performanceTest = test.extend({
  trace: { mode: "retain-on-failure", snapshots: false },
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
export async function waitForStableViewport(page: Page) {
  await expect(page.getByTestId("canvas-wrap")).not.toHaveAttribute("data-pane-pending", "true");
  return waitForStable(() => viewportTransform(page));
}

/**
 * Selection publishes before pointer-up reveals the Inspector and pans the narrower canvas.
 * Wait for that boundary before measuring the next gesture; selection/locator visibility alone
 * can still describe the old pane. Call only when the selection is meant to open the Inspector.
 */
export async function waitForSelectionSettled(page: Page) {
  await expect(page.getByTestId("inspector")).not.toHaveAttribute("data-collapsed", "1");
  await waitForStableBox(page.getByTestId("canvas-wrap"));
  await waitForStableViewport(page);
}

/**
 * Waits until the canvas camera has nothing queued, deferred or moving: `data-camera-state="idle"` on canvas-wrap,
 * which its controller (src/canvas/camera/controller.ts) holds for the whole lifetime of pending pane work, a
 * pointer-up's Inspector change, a reveal waiting for measurement, a fit's refinement and a move in flight. Work
 * deferred by an open menu reads `deferred`, never idle. Live's panel, trace card and narration fits and slow
 * motion's camera are the controller's too. A pan or zoom by hand isn't camera work: wait for it with
 * waitForStableViewport.
 */
export async function waitForCameraIdle(page: Page | FrameLocator) {
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-camera-state", "idle");
}

/** One command the canvas camera ran (e2e builds only; see src/canvas/camera/journal.ts). */
export interface CameraJournalEntry {
  seq: number;
  command: string;
  cause?: string;
  moved: boolean;
  from: { x: number; y: number; zoom: number };
  to?: { x: number; y: number; zoom: number };
}

/** The camera commands run since `after` (a length from an earlier read), as "command:cause" strings or entries. */
export async function cameraJournal(page: Page, after = 0): Promise<CameraJournalEntry[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __cameraJournal?: CameraJournalEntry[] }).__cameraJournal ?? [],
  );
  return all.slice(after);
}

/** The journal's length now: pass it to cameraJournal to read only what follows. */
export async function cameraJournalMark(page: Page): Promise<number> {
  return (await cameraJournal(page)).length;
}

/**
 * Waits until nothing is open over the canvas and no focus move is waiting: `data-interaction-state="idle"` on
 * canvas-wrap, which its interaction controller (src/canvas/interaction/controller.ts) holds while a menu or the
 * shortcuts dialog is open (`menu-open`) and while a focus move waits for its commit, frame or target
 * (`focus-pending`). A request waiting for a folded Inspector to open doesn't hold it.
 */
export async function waitForInteractionIdle(page: Page | FrameLocator) {
  await expect(page.getByTestId("canvas-wrap")).toHaveAttribute("data-interaction-state", "idle");
}

/** One decision or move result the canvas's interaction controller journaled (e2e builds only). */
export interface InteractionJournalEntry {
  seq: number;
  /** "menu.closed:escape", "selection.changed:keyboard", "focus.result", ... */
  event: string;
  /** "focus:element@commit", "keep", ... */
  command: string;
  result?: "focused" | "fallback" | "kept" | "gone" | "superseded";
}

/** The interaction journal since `after` (a length from interactionJournalMark), as entries. */
export async function interactionJournal(page: Page, after = 0): Promise<InteractionJournalEntry[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __interactionJournal?: InteractionJournalEntry[] }).__interactionJournal ?? [],
  );
  return all.slice(after);
}

/** The interaction journal's length now: pass it to interactionJournal to read only what follows. */
export async function interactionJournalMark(page: Page): Promise<number> {
  return (await interactionJournal(page)).length;
}

/** The interaction journal since `after` as "event -> command" lines, and "result: command" for each move's end. */
export async function interactionLog(page: Page, after = 0): Promise<string[]> {
  return (await interactionJournal(page, after)).map((e) =>
    e.result ? `${e.result}: ${e.command}` : `${e.event} -> ${e.command}`,
  );
}

/**
 * Which level took each of live view's Space, Enter and Esc presses since `after` ("escape:trace", "space:toggle"):
 * the live.key decisions in the interaction journal (src/canvas/interaction/liveKeys.ts).
 */
export async function liveKeyLevels(page: Page, after = 0): Promise<string[]> {
  return (await interactionJournal(page, after))
    .filter((e) => e.event.startsWith("live.key:"))
    .map((e) => e.event.slice("live.key:".length));
}

/** What moved the view, in order: "fit:pane", "reveal:placement" (commands that left the view as it was are left out). */
export async function cameraMoves(page: Page, after = 0): Promise<string[]> {
  return (await cameraJournal(page, after))
    .filter((e) => e.moved)
    .map((e) => (e.cause ? `${e.command}:${e.cause}` : e.command));
}

/**
 * Fits the whole diagram to the canvas (Fit diagram, Shift+1) and waits for the view to settle. The canvas
 * never scrolls (overflow: clip), so a node past its edge, under the inspector or the AI rail, can't be
 * clicked until the view brings it back: a selection that opened the inspector, or a smaller window,
 * can leave one there.
 */
export async function fitDiagram(page: Page) {
  await waitForStableViewport(page);
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("Shift+Digit1");
  await waitForStableViewport(page);
}

/** A real uncovered point on the canvas, even after a side sheet changes its width. */
export async function emptyCanvasPoint(page: Page, dx = 0) {
  await waitForStableViewport(page);
  return page.getByTestId("canvas-wrap").evaluate((wrap, dx) => {
    const box = wrap.getBoundingClientRect();
    const flow = wrap.querySelector('[data-testid="rf__wrapper"]');
    const pane = wrap.querySelector('[data-testid="canvas-pane"]');
    const xs = [box.width / 2 + dx, box.width / 2, box.width - 24, 24, box.width / 4, box.width * 0.75];
    const ys = [90, 160, 200, box.height * 0.4, box.height * 0.6, box.height - 180];
    for (const y of ys)
      for (const x of xs) {
        if (x < 16 || x > box.width - 16 || y < 16 || y > box.height - 16) continue;
        const hit = document.elementFromPoint(box.x + x, box.y + y)?.closest("[data-testid]");
        if (hit === pane || hit === flow || hit === wrap) return { x, y };
      }
    throw new Error("Expected an uncovered canvas point");
  }, dx);
}

/** The canvas viewport's CSS transform (React Flow's pan and zoom). */
export const viewportTransform = (page: Page) =>
  page
    .getByTestId("canvas-wrap")
    .evaluate((wrap) => wrap.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "");

/**
 * Pauses an installed page clock (`page.clock.install()`) where it stands. Until paused it runs in step with real
 * time, and `pauseAt` can't go back: a time read from the page is behind the clock by the time `pauseAt` arrives
 * (more so on a busy machine; a margin of 50 ms failed on CI, nightly #78), so no margin is safe. `pauseAt` stops
 * the clock before it refuses a time in the past, so a refusal leaves it standing: read it again, standing, and
 * pause there.
 */
export async function pauseClock(page: Page) {
  await pauseClocks(
    () =>
      Promise.all(
        page
          .context()
          .pages()
          .flatMap((p) => p.frames())
          .map((frame) => frame.evaluate(() => Date.now())),
      ),
    (time) => page.clock.pauseAt(time),
  );
}

export function expectNoErrors(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}

/**
 * How long a lazily loaded view may take to appear after `page.goto`: the navigation timeout. The views
 * (canvas with the live view, Lab, stencils) and the examples load after the page's load event, so
 * waiting for them is still loading the page, not the app reacting. On the dev server that's ~150 more
 * unbundled modules, which a busy CI runner once took 13 s to serve (nightly #40).
 */
export const pageLoadTimeout = () => base.info().project.use.navigationTimeout ?? 20_000;

const htmlTemplates = new WeakMap<Page, Promise<void>>();

/**
 * Call before opening the first export dialog on this page, then await before downloading. Its viewer is
 * built on demand in dev. Subsequent dialogs reuse the app's cached template (there is no second request).
 */
export function waitForHtmlTemplate(page: Page): Promise<void> {
  let ready = htmlTemplates.get(page);
  if (!ready) {
    ready = page
      .waitForResponse(
        (response) => /\/export\/interactive-viewer(?:-[a-f0-9]+)?\.html$/.test(new URL(response.url()).pathname),
        { timeout: pageLoadTimeout() },
      )
      .then(async (response) => {
        expect(response.ok()).toBe(true);
        expect(await response.finished()).toBeNull();
      });
    htmlTemplates.set(page, ready);
  }
  return ready;
}

export async function gotoGallery(page: Page) {
  await page.goto("./?view=gallery");
  await expect(page.getByTestId("gallery-view")).toBeVisible({ timeout: pageLoadTimeout() });
}

export async function gotoCanvas(page: Page, slug: string) {
  await page.goto(`./?view=canvas&example=${encodeURIComponent(slug)}`);
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
}

/**
 * The Checks teaching case, imported into Your diagrams: an invoice integration whose ledger worker fails in
 * "Poison invoices" while its ledger-posting subscription has no dead-letter queue. Exactly one warning
 * (dead-letter:posting-sub) and two suggestions (dead-letter:approval-sub, no-reader:dlq). It is the Azure
 * example as it was before the gallery gave every queue a DLQ (tests/fixtures/checks/service-bus-missing-dlq.diagram.json).
 */
export const MISSING_DLQ_FIXTURE = "tests/fixtures/checks/service-bus-missing-dlq.diagram.json";
export async function openMissingDlq(page: Page) {
  await gotoCanvas(page, "aks-app-config-key-vault");
  await page.getByTestId("import-input").setInputFiles({
    name: "service-bus-missing-dlq.diagram.json",
    mimeType: "application/json",
    buffer: readFileSync(MISSING_DLQ_FIXTURE),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Invoice intake without a ledger DLQ");
  await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
  // Dismiss the import's own notice, so the page starts as an opened example does: with no toast.
  await expect(page.getByTestId("toast")).toContainText("Imported “Invoice intake without a ledger DLQ”.");
  await page.getByTestId("toast-dismiss").click();
  await expect(page.getByTestId("toast")).toHaveCount(0);
}

/** File ▸ Share…: every way out, safest first. Waits for the chooser (its code loads on first use). */
export async function openShareChooser(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-share").click();
  await expect(page.getByTestId("share-chooser")).toBeVisible({ timeout: pageLoadTimeout() });
}

/** Share…'s rows: the private and controlled ones, then the public ones (behind their own step). */
export type ShareOption = "html" | "file" | "embed" | "password" | "link" | "embed-public" | "edit-together";

/** File ▸ Share… ▸ one row. The public ones (`link`, `embed-public`) take the deliberate step that shows them first. */
export async function shareVia(page: Page, option: ShareOption) {
  await openShareChooser(page);
  if (option === "link" || option === "embed-public") await page.getByTestId("share-public-toggle").click();
  await page.getByTestId(`share-option-${option}`).click();
}

/** Opens `url` (a live view: `live=1`) and waits for the live controls. */
export async function gotoLive(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
}

/** Live summaries disclose their full readouts only after an explicit pin and section choice. */
export async function openLiveNodeDetails(page: Page, id: string, section: string) {
  await page.getByTestId(`node-${id}`).evaluate((el) => el.parentElement?.focus());
  await page.keyboard.press("Enter");
  const row = page.getByTestId(`hover-section-${section}`);
  await expect(row).toBeVisible();
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}

/** Wait for the requested session's download and mount before asserting its controls.
 * Module loading uses the whole-test hang backstop; the UI assertions keep their normal timeout.
 */
export async function waitForLiveSession(page: Page) {
  await expect(page.getByTestId("live-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("live-toggle").evaluate(
    (button) =>
      new Promise<void>((resolve) => {
        const ready = () => {
          if (button.getAttribute("aria-busy") !== "false") return;
          observer.disconnect();
          resolve();
        };
        const observer = new MutationObserver(ready);
        observer.observe(button, { attributes: true, attributeFilter: ["aria-busy"] });
        ready();
      }),
  );
  await expect(page.getByTestId("live-controls")).toBeVisible();
}

export type LabControls = Record<string, string | number | boolean>;

/**
 * Opens the Lab on a preset, with optional control overrides (applied from the URL), and waits until the
 * preset has rendered: the stage names its preset while a preview that needs an example still shows
 * "Loading example…" (the example downloads on demand).
 */
export async function gotoLab(page: Page, preset?: string, controls: LabControls = {}) {
  const p = new URLSearchParams({ view: "lab" });
  if (preset) p.set("preset", preset);
  for (const [k, v] of Object.entries(controls)) p.set(k, String(v));
  await page.goto(`./?${p}`);
  await expect(page.getByTestId("lab-view")).toBeVisible({ timeout: pageLoadTimeout() });
  if (!preset) return;
  await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", preset);
  await expect(page.getByTestId("lab-example-loading")).toHaveCount(0, { timeout: pageLoadTimeout() });
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

/** Opens a diagram without coupling callers to the picker's menu or gallery layout.
 * Deliberately doesn't wait for the diagram download: lazy-load race tests control it.
 */
export async function openExample(page: Page, slug: string) {
  await page.getByTestId("example-picker").click();
  const own = page.getByTestId(`picker-option-${slug}`);
  if (await own.count()) return own.click();
  if (slug === "new") return page.getByTestId("picker-new").click();
  if (slug === "imported" || /^my-[a-z0-9]{6,32}$/.test(slug)) {
    await page.getByTestId("picker-library").click();
    return page.getByTestId(`library-open-${slug}`).click();
  }
  await page.getByTestId("picker-browse-examples").click();
  await page.getByTestId("examples-search").fill(slug);
  await page.getByTestId(`example-open-${slug}`).click();
}

export async function currentDiagram(page: Page): Promise<string> {
  const slug = await page.getByTestId("example-picker").getAttribute("data-diagram-slug");
  if (!slug) throw new Error("No open diagram");
  return slug;
}
