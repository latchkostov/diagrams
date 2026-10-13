import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserContext, FrameLocator, Page } from "@playwright/test";
import { expect, publicExamples } from "./fixtures";

// Opening an Interactive HTML file (src/export) the way people do: from file://, framed by a host page, sandboxed.
// Shared by the app's export (html-export.spec.ts) and the agent skill's (skill-html.spec.ts). Selectors are
// data-testid only.

export const KAFKA = "kafka-order-pipeline";
const kafkaNodes = publicExamples.find((e) => e.slug === KAFKA)?.nodeIds ?? [];

/** The text of the file's #diagram data block. */
export function filePayloadText(html: string): string {
  const json = /<script type="application\/json" id="diagram">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) throw new Error("No payload in the file");
  return json;
}

/** The payload the file carries (its #diagram data block). */
export function filePayload(html: string): {
  diagram: { title: string; private?: boolean };
  options: { theme: "light" | "dark"; banner?: string; startSimulation: string | null; exportedOn: string };
} {
  return JSON.parse(filePayloadText(html));
}

declare global {
  interface Window {
    __violations?: string[];
    /** The browser's own stores, kept before the viewer swaps in its in-memory ones (absent where denied). */
    __realStorage?: Storage;
    __realSession?: Storage;
  }
}

/** A fresh tab that records every request it makes, its CSP violations and its console errors. */
export async function watchedPage(context: BrowserContext) {
  const page = await context.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    if (m.type() === "error" || /Content Security Policy|Refused to/i.test(m.text()))
      errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const seen: string[] = (window.__violations = []);
    document.addEventListener("securitypolicyviolation", (e) =>
      seen.push(`${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"}`),
    );
    // A sandboxed frame (an opaque origin) throws on any storage access.
    try {
      window.__realStorage = window.localStorage;
      window.__realSession = window.sessionStorage;
    } catch {
      // Denied: the viewer must cope.
    }
  });
  return { page, requests, errors };
}

/** A local page that frames the file, as SharePoint or Confluence would. */
export function hostPage(file: string, sandbox?: string) {
  const host = join(dirname(file), sandbox ? "host-sandboxed.html" : "host.html");
  const attrs = sandbox ? `sandbox="${sandbox}" ` : "";
  writeFileSync(
    host,
    `<!doctype html><title>Host</title><h1>Team wiki</h1><iframe data-testid="frame" ${attrs}src="${encodeURIComponent(
      basename(file),
    )}" style="width:1100px;height:640px;border:0"></iframe>`,
  );
  return pathToFileURL(host).href;
}

/** Painted pixels on the live particle canvas (main-thread renderer, so the page can read it). */
export function particleSample(scope: Page | FrameLocator) {
  return scope.getByTestId("live-canvas").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d");
    if (!ctx || !c.width || !c.height) return "";
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let painted = 0;
    let hash = 0;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] > 40) {
        painted++;
        hash = (hash * 31 + i) | 0;
      }
    return painted ? `${painted}:${hash}` : "";
  });
}

/**
 * The Kafka example (KAFKA), exported with both simulations: the viewer shows every node with its icon, plays the
 * simulation (particles move), and switching runs the other simulation: its own narration, its node going down,
 * its clock moving on and its particles.
 */
export async function expectPlaying(scope: Page | FrameLocator) {
  await expect(scope.getByTestId("html-viewer")).toBeVisible();
  expect(kafkaNodes.length).toBeGreaterThan(10);
  for (const id of kafkaNodes) await expect(scope.getByTestId(`node-${id}`)).toBeVisible();
  // Icons are data URIs that loaded under the file's CSP.
  const icon = scope.getByTestId(`node-${kafkaNodes[0]}`).locator("img").first();
  await expect(icon).toHaveAttribute("src", /^data:image\/svg\+xml,/);
  await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await expect(scope.getByTestId("live-controls")).toBeVisible();
  await expect(scope.getByTestId("live-sim-picker")).toHaveValue("black-friday");
  await expect(scope.getByTestId("live-play")).toHaveAttribute("data-state", "playing");
  // Particles move: the painted pixels change from one sample to the next.
  await expect.poll(() => particleSample(scope), { timeout: 10_000 }).not.toBe("");
  const a = await particleSample(scope);
  await expect.poll(() => particleSample(scope), { timeout: 10_000 }).not.toBe(a);

  await scope.getByTestId("live-sim-picker").selectOption("payments-outage");
  await expect(scope.getByTestId("live-sim-picker")).toHaveValue("payments-outage");
  await scope.getByTestId("live-speed").selectOption("4");
  // Its own timeline at 4 s: payments goes down, and its note pauses the run.
  await expect(scope.getByTestId("live-note")).toContainText("Payments is offline", { timeout: 15_000 });
  await expect(scope.getByTestId("node-badge-payments")).toHaveAttribute("data-status", "down");
  await expect(scope.getByTestId("live-play")).toHaveAttribute("data-state", "waiting");
  const paused = await scope.getByTestId("live-clock").innerText();
  await scope.getByTestId("live-note-continue").click();
  await expect(scope.getByTestId("live-clock")).not.toHaveText(paused, { timeout: 10_000 });
  const b = await particleSample(scope);
  await expect.poll(() => particleSample(scope), { timeout: 10_000 }).not.toBe(b);
}
