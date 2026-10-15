// Reading the canvas as drawn: every React Flow node's box (its position in flow coordinates and its measured
// size), every edge's path, every edge label's placement and the fitted viewport. Elements are found by data-testid
// only (React Flow's own rf__node- ids and the app's edge- ids). Numbers are exact: the browser tier runs in one
// pinned Linux image (docs/PARITY.md, Browser tier).
import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/golden";

export interface Drawn {
  viewport: string;
  nodes: Record<string, unknown>;
  edges: Record<string, string>;
  labels: Record<string, unknown>;
}

/** The diagram as the app's file has it (for counts), read from src/examples. */
export function exampleFile(slug: string): { nodes: unknown[]; edges: unknown[]; title: string } {
  return JSON.parse(readFileSync(join(ROOT, "src/examples", `${slug}.json`), "utf8")) as {
    nodes: unknown[];
    edges: unknown[];
    title: string;
  };
}

/** Everything about the drawing, in flow coordinates; read inside the page. */
export async function readCanvas(page: Page, root = "canvas-wrap"): Promise<Drawn> {
  return page.evaluate((rootId) => {
    const scope = document.querySelector(`[data-testid="${rootId}"]`) ?? document;
    const nodes: Record<string, unknown> = {};
    let viewport = "";
    for (const el of scope.querySelectorAll<HTMLElement>('[data-testid^="rf__node-"]')) {
      const id = (el.dataset.testid ?? "").slice("rf__node-".length);
      const inner = el.firstElementChild as HTMLElement | null;
      nodes[id] = {
        kind: inner?.dataset.testid?.replace(/-.*$/, "") ?? "",
        box: `${el.style.transform} ${el.offsetWidth}×${el.offsetHeight}`,
        text: (el.innerText || "").replace(/\s+/g, " ").trim(),
      };
      viewport ||= (el.parentElement?.parentElement as HTMLElement | null)?.style.transform ?? "";
    }
    const edges: Record<string, string> = {};
    // An edge is the app's <g data-testid="edge-<id>"> (its deny marker is a <g> too: edge-deny-<id>).
    for (const el of scope.querySelectorAll<SVGGElement>('g[data-testid^="edge-"]:not([data-testid^="edge-deny-"])')) {
      const id = (el.dataset.testid ?? "").slice("edge-".length);
      edges[id] = el.querySelector("path")?.getAttribute("d") ?? "";
    }
    const labels: Record<string, unknown> = {};
    for (const el of scope.querySelectorAll<HTMLElement>('[data-testid^="edge-label-"]')) {
      const id = (el.dataset.testid ?? "").slice("edge-label-".length);
      if (id === "input") continue;
      labels[id] = { style: el.getAttribute("style") ?? "", text: (el.innerText || "").replace(/\s+/g, " ").trim() };
    }
    return { viewport, nodes, edges, labels };
  }, root);
}

/** Reads until two reads a few frames apart agree: the measured sizes, routes and fit view have settled. */
export async function settledCanvas(page: Page, root = "canvas-wrap"): Promise<Drawn> {
  let last = "";
  let drawn: Drawn = { viewport: "", nodes: {}, edges: {}, labels: {} };
  await expect
    .poll(
      async () => {
        await page.evaluate(
          () =>
            new Promise<void>((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
            ),
        );
        drawn = await readCanvas(page, root);
        const text = JSON.stringify(drawn);
        const same = text === last && Object.keys(drawn.nodes).length > 0;
        last = text;
        return same;
      },
      { intervals: [50, 100, 200, 400] },
    )
    .toBe(true);
  return drawn;
}

/**
 * Opens a public example on the canvas and waits until every node and edge is drawn and settled, then fits the view
 * again. The automatic fit on opening keeps clear of the floating chrome that is on screen at that moment, and under
 * load some of it can arrive later, so its framing varies with timing (reported; docs/PARITY.md). Fit view, with the
 * chrome in place, doesn't.
 */
export async function openExample(page: Page, slug: string): Promise<Drawn> {
  const file = exampleFile(slug);
  await page.goto(`./?view=canvas&example=${encodeURIComponent(slug)}`);
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  await expect(page.getByTestId(/^rf__node-/)).not.toHaveCount(0);
  if (file.edges.length)
    await expect(page.locator('g[data-testid^="edge-"]:not([data-testid^="edge-deny-"])')).toHaveCount(
      file.edges.length,
    );
  await settledCanvas(page);
  await page.getByTestId("fit-view-button").click();
  return settledCanvas(page);
}

/** Runs a command from Ctrl+K by its action id (src/editor/actions.ts). */
export async function command(page: Page, query: string, actionId: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-input").fill(query);
  await page.getByTestId(`command-item-action:${actionId}`).click();
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
}
