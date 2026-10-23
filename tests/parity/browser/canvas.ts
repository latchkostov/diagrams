// Reading the canvas as drawn: every React Flow node's box (its position in flow coordinates and its measured
// size), every edge's path, every edge label's placement and the fitted viewport. Elements are found by data-testid
// only (React Flow's own rf__node- ids and the app's edge- ids). Numbers are exact: the browser tier runs in one
// pinned Linux image (docs/PARITY.md, Browser tier).
import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/golden";
import { readyFonts } from "../../../src/canvas/fonts";
import type { DiagramFile } from "../../../src/model/types";
import { runChecks } from "../../../src/checks/run";

export interface Drawn {
  viewport: string;
  nodes: Record<string, unknown>;
  edges: Record<string, string>;
  labels: Record<string, unknown>;
}

/** The diagram as the app's file has it (for counts), read from src/examples. */
export function exampleFile(slug: string): DiagramFile {
  if (slug === "corpus-hand-shaped-lines")
    return JSON.parse(
      readFileSync(join(ROOT, "tests/parity/corpus/hand-shaped-lines.diagram.json"), "utf8"),
    ) as DiagramFile;
  return JSON.parse(readFileSync(join(ROOT, "src/examples", `${slug}.json`), "utf8")) as DiagramFile;
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
    // An edge is the app's <g data-testid="edge-<id>">. Its deny marker is a <g data-testid="edge-deny-<id>"> inside it,
    // so a marker is told apart by its place, not its name (an edge's own id may start with "deny-").
    const edgeGroups = [...scope.querySelectorAll<SVGGElement>('g[data-testid^="edge-"]')].filter(
      (g) => !g.parentElement?.closest('g[data-testid^="edge-"]'),
    );
    for (const el of edgeGroups) {
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
  await page.getByTestId(root).evaluate(readyFonts);
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
        const ready = await page.getByTestId(root).evaluate(
          (scope) =>
            !scope.querySelector('[data-route-pending="true"]') &&
            scope.dataset.fitPending !== "true" &&
            scope.dataset.panePending !== "true" &&
            [...scope.querySelectorAll<HTMLElement>('[data-testid^="rf__node-"]')].every((el) => {
              // A saved empty boundary has no measurable area; its descendants are checked
              // independently. Do not confuse it with a card whose measurement is still missing.
              const emptyBoundary =
                el.firstElementChild?.getAttribute("data-testid")?.startsWith("group-") &&
                (!el.offsetWidth || !el.offsetHeight);
              return (
                emptyBoundary ||
                (el.offsetWidth > 0 && el.offsetHeight > 0 && getComputedStyle(el).visibility === "visible")
              );
            }),
        );
        drawn = await readCanvas(page, root);
        // Text is still pinned in the returned golden. Readiness depends on geometry: live
        // badges/counters can keep changing their words without moving a single box or route.
        const geometry = {
          ...drawn,
          nodes: Object.fromEntries(
            Object.entries(drawn.nodes).map(([id, n]) => {
              const box = n as { kind: string; box: string };
              return [id, { kind: box.kind, box: box.box }];
            }),
          ),
        };
        const text = JSON.stringify(geometry);
        const same = ready && text === last && Object.keys(drawn.nodes).length > 0;
        last = text;
        return same;
      },
      { intervals: [50, 100, 200, 400] },
    )
    .toBe(true);
  return drawn;
}

/**
 * Opens a public example and waits for its measured, fitted drawing. Opening uses the same
 * measurement gate as Fit view, so no corrective click is necessary.
 */
export async function openExample(page: Page, slug: string): Promise<Drawn> {
  const file = exampleFile(slug);
  if (slug === "corpus-hand-shaped-lines")
    await page.addInitScript(
      (diagram) => localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", JSON.stringify(diagram)),
      file,
    );
  await page.goto(
    `./?view=canvas&example=${encodeURIComponent(slug === "corpus-hand-shaped-lines" ? "kafka-order-pipeline" : slug)}`,
  );
  await expect(page.getByTestId("canvas-view")).toBeVisible();
  const nodeIds = [
    ...file.nodes.map((n) => n.id),
    ...(file.groups ?? []).map((g) => `group:${g.id}`),
    ...(file.annotations ?? []).map((a) => a.id),
  ];
  await expect(page.getByTestId(/^rf__node-/)).toHaveCount(nodeIds.length);
  for (const id of nodeIds) await expect(page.getByTestId(`rf__node-${id}`)).toHaveCount(1);
  // Every connection in the file is drawn (by its own id: an id may start with "deny-", like a deny marker's).
  for (const edge of file.edges) await expect(page.getByTestId(`edge-${edge.id}`)).toHaveCount(1);
  return settledCanvas(page);
}

/** Runs a command from Ctrl+K by its action id (src/editor/actions.ts). */
export async function command(page: Page, query: string, actionId: string): Promise<void> {
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.getByTestId("command-input").fill(query);
  await page.getByTestId(`command-item-action:${actionId}`).click();
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
}

const nodeBoxes = (drawn: Drawn) =>
  Object.fromEntries(Object.entries(drawn.nodes).map(([id, n]) => [id, (n as { box: string }).box]));

/** Background warnings add a row to the title card. Layout commands must see that final footprint. */
export async function checksChrome(page: Page, slug: string): Promise<void> {
  const warnings = runChecks(exampleFile(slug)).findings.filter((f) => f.severity === "warning").length;
  // Zero warnings adds no chrome, so there is no footprint change to wait for.
  if (warnings)
    await expect(page.getByTestId("checks-count")).toHaveText(`${warnings} warning${warnings === 1 ? "" : "s"}`);
}

/** Auto-layout can already be the saved layout: that makes no undo step. Never click a disabled Undo. */
export async function restoreOpening(page: Page, opened: Drawn, laidOut: Drawn): Promise<void> {
  if (JSON.stringify(nodeBoxes(opened)) === JSON.stringify(nodeBoxes(laidOut))) {
    await expect(page.getByTestId("undo-button")).toBeDisabled();
    return;
  }
  await expect(page.getByTestId("undo-button")).toBeEnabled();
  await page.getByTestId("undo-button").click();
  expect(nodeBoxes(await settledCanvas(page))).toEqual(nodeBoxes(opened));
}

/** React Flow exposes node selection by class, not aria-selected. Locate its wrappers by test id. */
export async function canvasSelection(page: Page): Promise<{ nodes: string[]; edges: string[] }> {
  return page.getByTestId("canvas-wrap").evaluate((scope) => ({
    nodes: [...scope.querySelectorAll<HTMLElement>('[data-testid^="rf__node-"]')]
      .filter((el) => el.classList.contains("selected"))
      .map((el) => (el.dataset.testid ?? "").slice("rf__node-".length))
      .sort(),
    edges: [...scope.querySelectorAll<SVGGElement>('g[data-testid^="edge-"]')]
      .filter((el) => !el.parentElement?.closest('g[data-testid^="edge-"]') && el.classList.contains("is-selected"))
      .map((el) => (el.dataset.testid ?? "").slice("edge-".length))
      .sort(),
  }));
}

/** Tidy everything, proving the selection before and inside the palette (which snapshots its context). */
export async function tidyAll(page: Page, drawn: Drawn): Promise<void> {
  await command(page, "Select all", "canvas.select-all");
  const all = { nodes: Object.keys(drawn.nodes).sort(), edges: Object.keys(drawn.edges).sort() };
  await expect.poll(() => canvasSelection(page)).toEqual(all);
  // Selecting everything opens the Inspector. Its pending fit must finish before Tidy changes the bounds.
  await settledCanvas(page);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await expect(page.getByTestId("command-input")).toBeFocused();
  await page.getByTestId("command-input").fill("Tidy up");
  expect(await canvasSelection(page)).toEqual(all);
  await page.getByTestId("command-item-action:selection.tidy").click();
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
}
