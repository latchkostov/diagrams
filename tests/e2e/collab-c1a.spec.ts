import type { BrowserContext, Page } from "@playwright/test";
import type { LabPacket } from "../../src/collab/lab/bridge";
import { test, expect, expectNoErrors, gotoLab, pauseClock, waitForStableViewport } from "./fixtures";

type TestWindow = Window & { __c1Deliver(packet: LabPacket): void; __c1Post(packet: LabPacket): Promise<void> };

/** Only encrypted transport packets cross isolated browser contexts. No socket or external service. */
async function relay(contexts: BrowserContext[], seed: number) {
  const pages = new Set<Page>(),
    ids = new Map<Page, string>();
  let paused = false;
  const queued: { from: Page; packet: LabPacket }[] = [];
  const deliver = async (from: Page, packet: LabPacket) => {
    ids.set(from, packet.from);
    if (paused) {
      queued.push({ from, packet });
      return;
    }
    await Promise.all(
      [...pages]
        .filter((p) => p !== from && !p.isClosed())
        .map(async (p) => {
          await p.evaluate((msg) => (window as TestWindow).__c1Deliver?.(msg), packet).catch(() => {});
        }),
    );
  };
  for (const context of contexts) {
    for (const p of context.pages()) pages.add(p);
    context.on("page", (p) => pages.add(p));
    await context.exposeBinding("__c1Post", ({ page }, packet: LabPacket) => deliver(page, packet));
    await context.addInitScript(
      ({ seed }) => {
        const handlers = new Set<(packet: LabPacket) => void>();
        (window as TestWindow).__c1Deliver = (p) => {
          for (const fn of handlers) fn(p);
        };
        window.__collabC1 = {
          room: { epoch: 0, secret: Uint8Array.from({ length: 32 }, (_, i) => (seed + i) % 256) },
          wire: {
            post: (p) => {
              void (window as TestWindow).__c1Post(p).catch(() => {});
            },
            subscribe: (fn) => {
              handlers.add(fn);
              return () => {
                handlers.delete(fn);
              };
            },
          },
        };
      },
      { seed },
    );
  }
  return {
    pause() {
      paused = true;
    },
    async resume() {
      paused = false;
      for (const { from, packet } of queued.splice(0)) await deliver(from, packet);
    },
    async disconnect(page: Page) {
      const from = ids.get(page);
      if (from) await deliver(page, { from, kind: "bye" });
      pages.delete(page);
    },
    attach(page: Page) {
      pages.add(page);
    },
  };
}

async function open(page: Page, join = false) {
  await gotoLab(page, "collab-c1a", join ? { join: 1 } : {});
  await expect(page.getByTestId("node-api")).toBeVisible();
  await waitForStableViewport(page);
}

async function name(page: Page, id: string, value: string) {
  await page.bringToFront();
  await page.getByTestId(`node-${id}`).click();
  await expect(page.getByTestId("inspector-field-label")).toBeVisible();
  await waitForStableViewport(page);
  await page.getByTestId(`node-${id}`).dblclick();
  const field = page.getByTestId("inspector-field-label");
  await expect(field).toBeFocused();
  await field.fill(value);
  await field.press("Enter");
}

test("isolated editors preserve a pending inspector edit, scope Undo/Redo, and handle remote deletion", async ({
  browser,
  context,
  page,
  baseURL,
  consoleErrors,
}) => {
  const other = await browser.newContext({ baseURL });
  const b = await other.newPage();
  const errors: string[] = [];
  b.on("pageerror", (e) => errors.push(e.message));
  const requests: string[] = [];
  for (const p of [page, b]) {
    p.on("websocket", (ws) => requests.push(ws.url()));
    p.on("request", (r) => {
      if (new URL(r.url()).origin !== new URL(baseURL ?? page.url()).origin) requests.push(r.url());
    });
  }
  await relay([context, other], 31);
  try {
    await open(page);
    await open(b, true);
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "synced");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await name(b, "db", "After suspended page returned");
    await expect(page.getByTestId("node-db")).toContainText("After suspended page returned");
    await page.getByTestId("node-api").dblclick();
    await pauseClock(page);
    const field = page.getByTestId("inspector-field-label");
    await field.fill("API draft stays");
    await name(b, "db", "Database by peer");
    await expect(page.getByTestId("node-db")).toContainText("Database by peer");
    await page.bringToFront();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("API draft stays");
    await expect(b.getByTestId("node-api")).toContainText("API draft stays");
    await field.press("Enter");
    await page.getByTestId("undo-button").click();
    await expect(b.getByTestId("node-api")).toContainText("API");
    await expect(b.getByTestId("node-api")).not.toContainText("draft");
    await expect(page.getByTestId("node-db")).toContainText("Database by peer");
    await page.getByTestId("redo-button").click();
    await expect(b.getByTestId("node-api")).toContainText("API draft stays");
    // The selected target disappears while its property sheet holds focus.
    await page.getByTestId("node-api").dblclick();
    await expect(field).toBeFocused();
    await b.getByTestId("fit-view-button").click();
    await waitForStableViewport(b);
    await b.getByTestId("node-api").click();
    await b.keyboard.press("Delete");
    await expect(page.getByTestId("node-api")).toHaveCount(0);
    await expect(field).toHaveCount(0);
    await page.bringToFront();
    await page.clock.runFor(32);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await expect(page.getByTestId("canvas-announce")).toContainText("removed by a peer");
    expect(requests).toEqual([]);
    expectNoErrors(consoleErrors);
    expectNoErrors(errors);
  } finally {
    await other.close();
  }
});

test("blocked clipboard keeps a selectable Lab recovery link", async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", { value: () => Promise.reject(new Error("blocked")) });
  });
  await open(page);
  await page.getByTestId("collab-copy-recovery-link").click();
  await expect(page.getByTestId("collab-link-fallback")).toContainText("Select and copy");
  await expect(page.getByTestId("collab-recovery-link")).toHaveValue(/#room=v1\./);
  expectNoErrors(consoleErrors);
});

test("all peers leave, reload recovers locally, offline work merges on rejoin, and unrelated autosave stays untouched", async ({
  browser,
  context,
  page,
  baseURL,
  consoleErrors,
}) => {
  const other = await browser.newContext({ baseURL });
  const b = await other.newPage();
  const wire = await relay([context, other], 61);
  try {
    await open(page);
    await open(b, true);
    await name(page, "api", "Before everybody left");
    await expect(b.getByTestId("node-api")).toContainText("Before everybody left");
    await wire.disconnect(b);
    await b.goto("about:blank");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
    await page.reload();
    await expect(page.getByTestId("node-api")).toContainText("Before everybody left");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
    await name(page, "api", "Offline local API");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
    await wire.disconnect(page);
    await page.goto("about:blank");
    wire.attach(b);
    await open(b, true);
    await expect(b.getByTestId("node-api")).toContainText("Before everybody left");
    await name(b, "db", "Offline peer database");
    wire.attach(page);
    await open(page, true);
    await expect(page.getByTestId("node-db")).toContainText("Offline peer database");
    await expect(b.getByTestId("node-api")).toContainText("Offline local API");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "synced");
    const leaked = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => /autosave/.test(key))
        .map(([, value]) => value)
        .join(""),
    );
    expect(leaked).not.toContain("Offline local API");
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("corrupt IndexedDB checkpoint recovers safely and quota failure preserves downloadable edits", async ({
  context,
  page,
  consoleErrors,
}) => {
  await relay([context], 91);
  await open(page);
  await name(page, "api", "Local checkpoint");
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("livediagrams-collab-recovery-v1", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("rooms", "readwrite");
      const store = tx.objectStore("rooms");
      const r = store.getAll();
      r.onsuccess = () => {
        for (const record of r.result as { ciphertext: Uint8Array }[]) {
          record.ciphertext[0] ^= 1;
          store.put(record);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId("collab-recovery-problem")).toContainText("damaged");
  await expect(page.getByTestId("node-api")).not.toContainText("Local checkpoint");
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await name(page, "api", "Keep quota-failed work");
  await expect(page.getByTestId("collab-recovery-problem")).toContainText("Could not save");
  await expect(page.getByTestId("collab-room-status")).not.toHaveAttribute("data-status", "saved-device");
  const downloaded = page.waitForEvent("download");
  await page.getByTestId("collab-save-copy").click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("Keep quota-failed work");
  expectNoErrors(consoleErrors);
});

test("the normal Lab recovery link reopens encrypted work without an injected key and handles tab reload", async ({
  context,
  page,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.getByTestId("collab-copy-recovery-link").click();
  await expect(page.getByTestId("collab-copy-recovery-link")).toHaveText("Recovery link copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("#room=v1.");
  await page.getByTestId("node-api").dblclick();
  await pauseClock(page);
  await page.getByTestId("inspector-field-label").fill("Saved without debounce");
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
  await page.clock.resume();
  await page.goto("about:blank");
  await page.goto(link);
  await expect(page.getByTestId("node-api")).toContainText("Saved without debounce");
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  const peer = await context.newPage();
  try {
    await peer.goto(link);
    await expect(peer.getByTestId("node-api")).toContainText("Saved without debounce");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "synced");
    // Native navigation, without the test relay's synthetic disconnect.
    await peer.goto(link);
    await name(peer, "db", "Rejoined tab");
    await expect(page.getByTestId("node-db")).toContainText("Rejoined tab");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "synced");
    await peer.close();
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
  } finally {
    if (!peer.isClosed()) await peer.close();
  }
  expectNoErrors(consoleErrors);
});
