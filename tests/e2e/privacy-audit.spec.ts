import { toggleTheme, currentDiagram, pauseClock } from "./fixtures";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { test, expect, gotoCanvas, gotoGallery, expectNoErrors, openMissingDlq, pageLoadTimeout } from "./fixtures";
import { MOD, SLUG, openAdvanced } from "./ai-helpers";

// The privacy audit's fixes (docs/PRIVACY-AUDIT.md): what a private diagram must never leave behind in the address
// bar, the browser's history, a request, a third party's script, a link embed or this browser's storage. Every
// diagram here is synthetic: "Quillfeather" is a made-up word, so finding it anywhere means the diagram leaked.
// Selectors are data-testid only.

const WORD = "quillfeather";
const SIM_ID = `storm-${WORD}-ledger`;

/** A synthetic work diagram with a simulation whose id is made from its words (as a storm's is). */
const work = (extra: object = {}) => ({
  format: "diagrams/v1",
  title: "Quillfeather payroll",
  nodes: [
    { id: `${WORD}-intake`, stencil: "generic.service", label: "Quillfeather intake", x: 0, y: 0 },
    { id: `${WORD}-ledger`, stencil: "postgres", label: "Quillfeather ledger", x: 320, y: 0 },
  ],
  edges: [{ id: "intake-to-ledger", from: `${WORD}-intake`, to: `${WORD}-ledger` }],
  simulations: [
    {
      id: SIM_ID,
      title: "Quillfeather month end",
      seed: 7,
      traffic: [
        {
          id: "runs",
          node: `${WORD}-intake`,
          messageType: "PayrollRun",
          shape: { kind: "constant", ratePerSec: 5, durationMs: 4000 },
        },
      ],
      timeline: [],
      expectations: [],
    },
  ],
  ...extra,
});

/** Imports a diagram into Your diagrams (private when the file says so) and returns its slug. */
async function importDiagram(page: Page, diagram: object) {
  await page.getByTestId("import-input").setInputFiles({
    name: "work.diagram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(diagram)),
  });
  await expect(page.getByTestId("diagram-title")).toHaveText("Quillfeather payroll");
  const slug = await currentDiagram(page);
  expect(slug).toMatch(/^my-/);
  return slug;
}

/** Goes live and plays the diagram's simulation from the live bar's picker. */
async function playSimulation(page: Page) {
  await page.getByTestId("live-toggle").click();
  await expect(page.getByTestId("live-controls")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("live-sim-picker").selectOption(SIM_ID);
  await expect(page.getByTestId("live-sim-picker")).toHaveValue(SIM_ID);
}

/** Every request the page makes, and whether it stays on the app's origin. */
function watchRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return {
    outside: (origin: string) =>
      urls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin && !u.startsWith("data:")),
    carrying: (word: string) => urls.filter((u) => decodeURIComponent(u).toLowerCase().includes(word)),
  };
}

/**
 * Fills this site's storage to the last character by growing one app key (diagrams.filler): true when not one more
 * character fits. Probing with the same key, one character longer, means a shorter key can't squeeze in after.
 */
const fillStorage = (page: Page) =>
  page.evaluate(() => {
    const key = "diagrams.filler";
    const fits = (n: number) => {
      try {
        localStorage.setItem(key, "x".repeat(n));
        return true;
      } catch {
        return false;
      }
    };
    let lo = 0;
    let hi = 1;
    while (fits(hi)) [lo, hi] = [hi, hi * 2];
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    fits(lo);
    return !fits(lo + 1);
  });

/** File ▸ Privacy ▸ Clear everything on this device…, up to its confirmation. */
async function openClearDevice(page: Page) {
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await expect(page.getByTestId("file-privacy-menu")).toBeVisible();
  await page.getByTestId("privacy-clear-device").click();
  await expect(page.getByTestId("clear-device-dialog")).toBeVisible();
}

const appOrigin = () => new URL(test.info().project.use.baseURL ?? "http://localhost").origin;

test.describe("the address bar and history", () => {
  test("a private diagram's simulation id never goes in the address bar; a public one's does", async ({
    page,
    consoleErrors,
  }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work());
    await playSimulation(page);
    // The live link of a diagram that can be shared names its simulation.
    await expect.poll(() => new URL(page.url()).searchParams.get("sim")).toBe(SIM_ID);
    await page.getByTestId("live-toggle").click();
    await expect(page.getByTestId("live-controls")).toHaveCount(0);

    await importDiagram(page, work({ private: true }));
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await playSimulation(page);
    await expect.poll(() => new URL(page.url()).searchParams.get("live")).toBe("1");
    expect(page.url().toLowerCase()).not.toContain(WORD);
    expect(new URL(page.url()).searchParams.has("sim")).toBe(false);
    expectNoErrors(consoleErrors);
  });

  test("a public diagram turned private while playing drops its simulation from the address bar", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work());
    await playSimulation(page);
    await expect.poll(() => new URL(page.url()).searchParams.get("sim")).toBe(SIM_ID);
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("private");
    await page.getByTestId("command-item-action:file.private").click();
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await expect.poll(() => page.url().toLowerCase()).not.toContain(WORD);
  });
});

test.describe("requests and third parties", () => {
  test("a private diagram's session: no request leaves the origin or carries its words", async ({
    page,
    consoleErrors,
  }) => {
    const requests = watchRequests(page);
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work({ private: true }));
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await page.keyboard.press("Escape");
    await playSimulation(page);
    await page.getByTestId("live-toggle").click();
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("intake");
    await expect(page.getByTestId(`command-item-node:${WORD}-intake`)).toBeVisible();
    await page.keyboard.press("Escape");
    expect(requests.outside(appOrigin())).toEqual([]);
    expect(requests.carrying(WORD)).toEqual([]);
    expectNoErrors(consoleErrors);
  });

  test("the File menu warms up storage providers for a public diagram, never for a private one", async ({ page }) => {
    // The test provider stands in for Google Drive, whose warm-up loads Google's scripts into the page.
    await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    const preloads = () =>
      page.evaluate(() => (window as { __testStoragePreloads?: number }).__testStoragePreloads ?? 0);
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await expect.poll(preloads).toBe(1);
    await page.keyboard.press("Escape");

    await importDiagram(page, work({ private: true }));
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await page.keyboard.press("Escape");
    // The provider's code is loaded once already, so a warm-up would have run by now: none did.
    expect(await preloads()).toBe(1);
  });

  test("a warm-up still loading when the diagram turns private stops there", async ({ page }) => {
    // Hold the provider's code, as a slow network would, while the diagram turns private. Its URL is a chunk in a
    // build and the module itself on the dev server.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let intercepted = false;
    await page.route(/\/testProvider(-[\w-]+\.js|\.ts)(\?.*)?$/, async (route) => {
      intercepted = true;
      await held;
      await route.continue();
    });
    await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await importDiagram(page, work());
    await page.getByTestId("file-button").click();
    await expect(page.getByTestId("file-privacy")).toBeVisible();
    await expect.poll(() => intercepted).toBe(true);
    await page.keyboard.press("Escape");
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("private");
    await page.getByTestId("command-item-action:file.private").click();
    await expect(page.getByTestId("private-badge")).toBeVisible();
    release();
    // The module has run: what awaited it (the warm-up decision) ran in the same turn, before this check's task.
    await expect
      .poll(() => page.evaluate(() => (window as { __testStorageLoaded?: boolean }).__testStorageLoaded))
      .toBe(true);
    expect(await page.evaluate(() => (window as { __testStoragePreloads?: number }).__testStoragePreloads ?? 0)).toBe(
      0,
    );
  });
});

for (const byDefault of [false, true]) {
  test(`a pending example save follows promotion privacy before provider loading (${byDefault ? "default" : "switch"})`, async ({
    page,
    consoleErrors,
  }) => {
    await page.clock.install();
    const requests = watchRequests(page);
    let release!: () => void;
    let intercepted = false;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/testProvider(-[\w-]+\.js|\.ts)(\?.*)?$/, async (route) => {
      intercepted = true;
      await held;
      await route.continue();
    });
    await page.goto(`./?view=canvas&example=${SLUG}&storage=test`);
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    await expect(page.getByTestId("example-badge")).toBeVisible();
    if (byDefault) {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-privacy").click();
      await page.getByTestId("privacy-new-diagrams").click();
    }
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-save-to").click();
    await page.getByTestId("save-to-test").click();
    await expect.poll(() => intercepted).toBe(true);
    await page.getByTestId("node-shopper").click();
    await page.getByTestId("inspector-field-label").fill("Quillfeather promoted work");
    await expect(page.getByTestId("example-picker")).toHaveAttribute("data-diagram-slug", /^my-/);
    const copy = await currentDiagram(page);
    if (!byDefault) {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-privacy").click();
      await page.getByTestId("privacy-diagram").click();
    }
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await pauseClock(page); // Keep the refusal observable; its expiry is not under test.
    release();
    await expect(page.getByTestId("toast")).toContainText("became private");
    const stored = await page.evaluate(
      (slug) => ({
        files: JSON.parse(localStorage.getItem("diagrams.test-storage.v1") ?? "[]"),
        document: JSON.parse(localStorage.getItem(`diagrams.doc.v1:${slug.slice(3)}`) ?? "null"),
        bindings: JSON.parse(localStorage.getItem("diagrams.bindings.v1") ?? "{}"),
      }),
      copy,
    );
    expect(stored.files).toEqual([]);
    expect(stored.document.target).toBeUndefined();
    expect(stored.bindings[SLUG]).toBeUndefined();
    expect(requests.outside(appOrigin())).toEqual([]);
    expect(requests.carrying(WORD)).toEqual([]);
    expect(page.url().toLowerCase()).not.toContain(WORD);
    expect(new URL(page.url()).hash).toBe("");
    expectNoErrors(consoleErrors);
  });
}

test.describe("embeds", () => {
  test("an embed reads the saved theme but writes nothing to storage", async ({ page, consoleErrors }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        localStorage.setItem("diagrams.settings.v1", JSON.stringify({ theme: "dark" }));
      }
    });
    await page.goto(`./?embed=1&example=${SLUG}`);
    await expect(page.getByTestId("embed-view")).toBeVisible();
    await expect(page.getByTestId("canvas-view")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(["diagrams.settings.v1"]);
    // Untouched: exactly what was saved before the embed opened.
    expect(await page.evaluate(() => localStorage.getItem("diagrams.settings.v1"))).toBe('{"theme":"dark"}');
    expectNoErrors(consoleErrors);
  });

  test("a link embed refuses a diagram marked private, with no link out", async ({ page, consoleErrors }) => {
    const payload = deflateRawSync(Buffer.from(JSON.stringify(work({ private: true })))).toString("base64url");
    await page.goto(`./?embed=1#d=${payload}`);
    await expect(page.getByTestId("embed-error")).toContainText("This diagram is private");
    await expect(page.getByTestId("embed-open-in-app")).toHaveCount(0);
    await expect(page.getByTestId(`node-${WORD}-intake`)).toHaveCount(0);

    // The same diagram, not private, shows.
    const open = deflateRawSync(Buffer.from(JSON.stringify(work()))).toString("base64url");
    await page.goto(`./?embed=1&x=1#d=${open}`);
    await expect(page.getByTestId(`node-${WORD}-intake`)).toBeVisible();
    expectNoErrors(consoleErrors);
  });
});

test.describe("this browser's storage", () => {
  test("Ctrl+K never remembers a private diagram's nodes", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work({ private: true }));
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("intake");
    await page.getByTestId(`command-item-node:${WORD}-intake`).click();
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    const recent = await page.evaluate(() => localStorage.getItem("diagrams.paletteRecent.v1") ?? "");
    expect(recent.toLowerCase()).not.toContain(WORD);
  });

  test("Clear everything on this device: one confirmation, then nothing of the diagrams is left, in any tab", async ({
    page,
    context,
    consoleErrors,
  }) => {
    test.slow(); // Both tabs navigate before and after the wipe.
    await gotoCanvas(page, SLUG);
    const slug = await importDiagram(page, work({ private: true }));
    // An AI conversation that names it (the panel keeps one per diagram).
    await page.evaluate((w) => localStorage.setItem("diagrams.ai-thread.v1:x", JSON.stringify({ turns: [w] })), WORD);
    const seedSession = (p: Page) =>
      p.evaluate(() => {
        sessionStorage.setItem("diagrams.pendingStencils.v1", '["kafka.topic"]');
        sessionStorage.setItem("other-app.state", "keep");
      });
    await seedSession(page);
    // Another tab, on the stencil library (its pending stencils wait for a canvas), that can't download any more of
    // the app's code: stopping and starting over needs none.
    const other = await context.newPage();
    await gotoGallery(other);
    await other.route(/(clearDevice|dialogs|clearOnPrivate)[-.][^/]*$/, (route) => route.abort());
    await seedSession(other);

    await openClearDevice(page);
    // Cancel is the default.
    await expect(page.getByTestId("clear-device-cancel")).toBeFocused();
    const otherReloads = other.waitForEvent("domcontentloaded", { timeout: pageLoadTimeout() });
    await Promise.all([
      page.waitForEvent("domcontentloaded", { timeout: pageLoadTimeout() }),
      page.getByTestId("clear-device-confirm").click(),
    ]);
    await otherReloads;
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(other.getByTestId("gallery-view")).toBeVisible({ timeout: pageLoadTimeout() });
    // The app starts over on a blank diagram, and nothing of the old one is anywhere in storage; each tab's session
    // storage loses the app's keys and keeps another app's.
    expect(page.url()).not.toContain(slug);
    await expect(page.getByTestId("diagram-title")).not.toHaveText("Quillfeather payroll");
    for (const p of [page, other]) {
      const stored = await p.evaluate(() =>
        Object.keys(localStorage)
          .map((k) => `${k}=${localStorage.getItem(k)}`)
          .join("\n"),
      );
      expect(stored.toLowerCase()).not.toContain(WORD);
      expect(stored).not.toContain("diagrams.library-entry.v1:");
      expect(stored).not.toContain("diagrams.ai-thread.v1:");
      expect(await p.evaluate(() => Object.keys(sessionStorage))).toEqual(["other-app.state"]);
    }
    await other.close();
    expectNoErrors(consoleErrors);
  });

  test("a tab that hears of the wipe late writes nothing, and deletes nothing made since", async ({
    page,
    context,
  }) => {
    test.slow(); // Both tabs start over, then the foreground tab imports new work.
    // A tab that misses both signals (a busy or throttled background tab): it learns at its next write.
    const late = await context.newPage();
    await late.addInitScript(() => {
      addEventListener("storage", (e) => e.key === "diagrams.generation" && e.stopImmediatePropagation());
      (window as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    });
    // This tab only changes a global setting; the gallery exercises the same storage guard without
    // loading a second canvas before and after the wipe.
    await Promise.all([gotoGallery(late), gotoCanvas(page, SLUG)]);
    await openClearDevice(page);
    await Promise.all([
      page.waitForEvent("domcontentloaded", { timeout: pageLoadTimeout() }),
      page.getByTestId("clear-device-confirm").click(),
    ]);
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    // New work, after the wipe.
    const fresh = await importDiagram(page, work());
    const entry = `diagrams.library-entry.v1:${fresh}`;
    expect(await page.evaluate((k) => localStorage.getItem(k), entry)).not.toBeNull();

    // The late tab changes a setting (a write): it writes nothing, and starts over.
    const reloads = late.waitForEvent("domcontentloaded", { timeout: pageLoadTimeout() });
    await toggleTheme(late);
    await reloads;
    await expect(late.getByTestId("gallery-view")).toBeVisible({ timeout: pageLoadTimeout() });
    expect(await page.evaluate((k) => localStorage.getItem(k), entry)).not.toBeNull();
    await expect(page.getByTestId("diagram-title")).toHaveText("Quillfeather payroll");
    await late.close();
  });

  test("filling storage works whatever is stored already", async ({ page }) => {
    await page.goto("./?view=gallery");
    await expect(page.getByTestId("gallery-view")).toBeVisible();
    for (const already of [0, 10_000, 1_000_000]) {
      await page.evaluate((n) => {
        localStorage.clear();
        if (n) localStorage.setItem("other-app.data", "y".repeat(n));
      }, already);
      expect(await fillStorage(page), `${already} stored`).toBe(true);
    }
    await page.evaluate(() => localStorage.clear());
  });

  test("a full storage still reaches every tab: the wipe frees the space its signal needs", async ({
    page,
    context,
  }) => {
    test.slow(); // Both tabs navigate before and after the wipe.
    await gotoCanvas(page, SLUG);
    const other = await context.newPage();
    // Only the storage event can reach this tab.
    await other.addInitScript(() => ((window as { BroadcastChannel?: unknown }).BroadcastChannel = undefined));
    await gotoGallery(other);
    // Fill the browser's storage for this site with an app key, to the last character.
    const full = await fillStorage(page);
    expect(full).toBe(true);
    await openClearDevice(page);
    const otherReloads = other.waitForEvent("domcontentloaded", { timeout: pageLoadTimeout() });
    await Promise.all([
      page.waitForEvent("domcontentloaded", { timeout: pageLoadTimeout() }),
      page.getByTestId("clear-device-confirm").click(),
    ]);
    await otherReloads;
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(other.getByTestId("gallery-view")).toBeVisible({ timeout: pageLoadTimeout() });
    expect(await page.evaluate(() => localStorage.getItem("diagrams.generation"))).not.toBeNull();
    expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("diagrams.filler")))).toBe(
      false,
    );
    await other.close();
  });

  test("Cancel and Esc keep everything: only the confirm button clears", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    const slug = await importDiagram(page, work({ private: true }));
    for (const close of ["cancel", "escape"]) {
      await page.getByTestId("file-button").click();
      await page.getByTestId("file-privacy").click();
      await page.getByTestId("privacy-clear-device").click();
      await expect(page.getByTestId("clear-device-dialog")).toBeVisible();
      if (close === "escape") await page.keyboard.press("Escape");
      else await page.getByTestId("clear-device-cancel").click();
      await expect(page.getByTestId("clear-device-dialog")).toHaveCount(0);
    }
    await page.reload();
    await expect(page.getByTestId("diagram-title")).toHaveText("Quillfeather payroll");
    expect(await page.evaluate((s) => localStorage.getItem(`diagrams.library-entry.v1:${s}`), slug)).not.toBeNull();
  });

  test("making a diagram private offers to clear its AI conversation, with Undo", async ({ page, consoleErrors }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work());
    // A turn in its conversation: a reply pasted in Advanced and applied.
    await openAdvanced(page);
    await page
      .getByTestId("ai-reply")
      .fill('[{ "op": "add_node", "kind": "Kafka topic", "label": "quillfeather-runs" }]');
    await page.getByTestId("ai-apply").click();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();
    const thread = () =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith("diagrams.ai-thread.v1:"))
          .map((k) => localStorage.getItem(k))
          .join(""),
      );

    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("private");
    await page.getByTestId("command-item-action:file.private").click();
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await page.getByTestId("private-clear-conversation").click();
    await expect(page.getByTestId("ai-turn-0")).toHaveCount(0);
    expect((await thread()).toLowerCase()).not.toContain(WORD);
    await page.getByTestId("private-clear-undo").click();
    await expect(page.getByTestId("ai-turn-0")).toBeVisible();
    expect((await thread()).toLowerCase()).toContain(WORD);
    expectNoErrors(consoleErrors);
  });

  test("a diagram with no AI conversation turns private with a plain toast", async ({ page }) => {
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work());
    await page.keyboard.press(`${MOD}+k`);
    await page.getByTestId("command-input").fill("private");
    await page.getByTestId("command-item-action:file.private").click();
    await expect(page.getByTestId("toast").last()).toContainText("Private: no share links");
    await expect(page.getByTestId("private-clear-conversation")).toHaveCount(0);
  });
});

test.describe("exports", () => {
  test("a private diagram's draw.io and Mermaid toasts never point at public sites", async ({
    page,
    context,
    consoleErrors,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoCanvas(page, SLUG);
    await importDiagram(page, work({ private: true }));
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-mermaid").click();
    const toast = page.getByTestId("toast").last();
    await expect(toast).toContainText("Mermaid flowchart copied. This diagram is private");
    await expect(toast).not.toContainText("mermaid.live");
    expectNoErrors(consoleErrors);
  });

  test("an image exported with the Checks card open has no check markers in it", async ({ page }, info) => {
    test.slow(); // rendering + font embedding is CPU-bound
    await openMissingDlq(page);
    await page.getByTestId("checks-count").click();
    await expect(page.getByTestId("check-marker-posting-sub")).toBeVisible();
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await expect(page.getByTestId("image-dialog")).toBeVisible();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      page.getByTestId("image-export").click(),
    ]);
    const path = info.outputPath("checked.svg");
    await download.saveAs(path);
    const svg = readFileSync(path, "utf8");
    expect(svg).toContain("posting-sub");
    expect(svg).not.toContain("check-marker");
  });
});
