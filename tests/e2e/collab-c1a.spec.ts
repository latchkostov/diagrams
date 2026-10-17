import type { BrowserContext, Page, Locator } from "@playwright/test";
import type { DiagramFile } from "../../src/model/types";
import type { LabPacket } from "../../src/collab/lab/bridge";
import { demoDiagram } from "../../src/collab/lab/demo";
import { RECOVERY_RETRY } from "../../src/collab/recovery";
import { test, expect, expectNoErrors, gotoLab, pauseClock, waitForStableViewport } from "./fixtures";

async function bounds(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Expected a visible element: " + locator.toString());
  return rect;
}

type TestWindow = Window & {
  __c1Deliver(packet: LabPacket): void;
  __c1Post(packet: LabPacket): Promise<void>;
  __c1CipherReads?: number;
  __c1LatePeerPackets?: number;
  __releaseRecoveryOpen?: () => void;
  __recoveryChannelsClosed?: number;
  __restoreRecoveryWrites?: () => void;
};

/** Only encrypted transport packets cross isolated browser contexts. No socket or external service. */
async function relay(contexts: BrowserContext[], seed: number, initial?: DiagramFile) {
  const pages = new Set<Page>(),
    ids = new Map<Page, string>();
  let paused = false;
  const queued: { from: Page; packet: LabPacket }[] = [];
  const broadcast = async (from: Page, packet: LabPacket) => {
    await Promise.all(
      [...pages]
        .filter((p) => p !== from && !p.isClosed())
        .map(async (p) => {
          await p.evaluate((msg) => (window as TestWindow).__c1Deliver?.(msg), packet).catch(() => {});
        }),
    );
  };
  const deliver = async (from: Page, packet: LabPacket) => {
    if (!pages.has(from)) return;
    ids.set(from, packet.from);
    if (paused) {
      queued.push({ from, packet });
      return;
    }
    await broadcast(from, packet);
  };
  for (const context of contexts) {
    for (const p of context.pages()) pages.add(p);
    context.on("page", (p) => pages.add(p));
    await context.exposeBinding("__c1Post", ({ page }, packet: LabPacket) => deliver(page, packet));
    await context.addInitScript(
      ({ seed, initial }) => {
        const handlers = new Set<(packet: LabPacket) => void>();
        (window as TestWindow).__c1Deliver = (p) => {
          for (const fn of handlers) fn(p);
        };
        window.__collabC1 = {
          initial,
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
      { seed, initial },
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
      pages.delete(page);
      if (from) await broadcast(page, { from, kind: "bye" });
      return from;
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
    await page.keyboard.press("Tab");
    await page.clock.runFor(32);
    await expect
      .poll(() => page.getByTestId("node-web").evaluate((el) => document.activeElement?.contains(el)))
      .toBe(true);
    await b.getByTestId("fit-view-button").click();
    await waitForStableViewport(b);
    await b.getByTestId("node-web").click();
    await b.keyboard.press("Delete");
    await expect(page.getByTestId("node-web")).toHaveCount(0);
    await page.clock.runFor(32);
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await b.getByTestId("canvas-wrap").focus();
    await b.keyboard.press("Control+z");
    await expect(b.getByTestId("node-web")).toBeVisible();
    await expect
      .poll(() => b.getByTestId("node-web").evaluate((el) => document.activeElement?.contains(el)))
      .toBe(true);
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

test("room recovery preserves an existing local autosave across reload and rejoin", async ({
  browser,
  context,
  page,
  baseURL,
  consoleErrors,
}) => {
  const other = await browser.newContext({ baseURL });
  const b = await other.newPage();
  const wire = await relay([context, other], 61);
  const localKey = "diagrams.autosave.v1:kafka-order-pipeline";
  const localValue = JSON.stringify({
    format: "diagrams/v1",
    title: "Local notebook",
    nodes: [{ id: "local-service", stencil: "service.go", label: "Local work survives", x: 0, y: 0 }],
    edges: [],
  });
  try {
    await gotoLab(page, "nodes-states");
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [localKey, localValue]);
    await open(page);
    await open(b, true);
    await name(page, "api", "Before everybody left");
    await expect(b.getByTestId("node-api")).toContainText("Before everybody left");
    await expect(b.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "true");
    const departed = await wire.disconnect(b);
    if (!departed) throw new Error("Expected the peer to have joined the relay");
    // A heartbeat already on its way out cannot reconnect a page whose wire was disconnected.
    await page.evaluate((from) => {
      (window as TestWindow).__c1LatePeerPackets = 0;
      window.__collabC1?.wire.subscribe((packet) => {
        if (packet.from === from) {
          const w = window as TestWindow;
          w.__c1LatePeerPackets = (w.__c1LatePeerPackets ?? 0) + 1;
        }
      });
    }, departed);
    await b.evaluate((from) => (window as TestWindow).__c1Post({ from, kind: "hello" }), departed);
    expect(await page.evaluate(() => (window as TestWindow).__c1LatePeerPackets)).toBe(0);
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
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
    expect(await page.evaluate((key) => localStorage.getItem(key), localKey)).toBe(localValue);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-local-service")).toContainText("Local work survives");
    expect(await page.evaluate((key) => localStorage.getItem(key), localKey)).toBe(localValue);
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
      const r = indexedDB.open("livediagrams-collab-recovery-v1");
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
  await expect(page.getByTestId("collab-recovery-problem")).toContainText("Some changes may be missing.");
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

test("storage retry backoff keeps edits unsaved until a successful retry", async ({ context, page, consoleErrors }) => {
  await relay([context], 145);
  await open(page);
  await name(page, "api", "Durable before storage failure");
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "true");
  await page.getByTestId("node-api").dblclick();
  const field = page.getByTestId("inspector-field-label");
  await expect(field).toBeFocused();
  await pauseClock(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as TestWindow).__restoreRecoveryWrites = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.transaction.db.name === "livediagrams-collab-recovery-v1")
        throw new DOMException("quota", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await field.fill("Storage failure");
  await expect(page.getByTestId("collab-recovery-problem")).toContainText("Could not save on this device");
  for (let i = 0; i < 8; i++) {
    await field.fill(`Still editable ${i}`);
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "false");
    await expect(page.getByTestId("collab-recovery-problem")).toContainText("Could not save on this device");
  }
  await expect(page.getByTestId("collab-save-copy")).toBeVisible();
  await page.evaluate(() => (window as TestWindow).__restoreRecoveryWrites?.());
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "false");
  await page.clock.runFor(RECOVERY_RETRY.initialMs);
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "true");
  await expect(page.getByTestId("collab-recovery-problem")).toHaveCount(0);
  await expect(field).toHaveValue("Still editable 7");
  await field.press("Enter");
  await page.clock.resume();
  await page.reload();
  await expect(page.getByTestId("node-api")).toContainText("Still editable 7");
  expectNoErrors(consoleErrors);
});

test("the normal Lab recovery link reopens encrypted work without an injected key and handles tab reload", async ({
  context,
  page,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.evaluate(() => {
    (window as TestWindow).__c1CipherReads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      if (this.name === "rooms")
        (window as TestWindow).__c1CipherReads = ((window as TestWindow).__c1CipherReads ?? 0) + 1;
      return get.call(this, query);
    };
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === "rooms")
        (window as TestWindow).__c1CipherReads = ((window as TestWindow).__c1CipherReads ?? 0) + 1;
      return getAll.apply(this, args);
    };
  });
  await page.getByTestId("collab-copy-recovery-link").click();
  await expect(page.getByTestId("collab-copy-recovery-link")).toHaveText("Recovery link copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("#room=v1.");
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
  // Exercise the metadata-only eviction schema's migration from the first Lab database.
  await gotoLab(page, "nodes-states");
  await page.evaluate(async () => {
    const open = (version?: number) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("livediagrams-collab-recovery-v1", version);
        r.onupgradeneeded = () => r.result.createObjectStore("rooms", { keyPath: "id" });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const current = await open();
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const tx = current.transaction("rooms", "readonly");
      const r = tx.objectStore("rooms").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    current.close();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("livediagrams-collab-recovery-v1");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    const legacy = await open(1);
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction("rooms", "readwrite");
      for (const record of records) tx.objectStore("rooms").put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    legacy.close();
  });
  await page.goto(link);
  await expect(page.getByTestId("node-api")).toBeVisible();
  await waitForStableViewport(page);
  await page.evaluate(() => {
    (window as TestWindow).__c1CipherReads = 0;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (query) {
      if (this.name === "rooms")
        (window as TestWindow).__c1CipherReads = ((window as TestWindow).__c1CipherReads ?? 0) + 1;
      return get.call(this, query);
    };
    const getAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === "rooms")
        (window as TestWindow).__c1CipherReads = ((window as TestWindow).__c1CipherReads ?? 0) + 1;
      return getAll.apply(this, args);
    };
  });
  await page.getByTestId("node-api").dblclick();
  await pauseClock(page);
  await page.getByTestId("inspector-field-label").fill("Saved without debounce");
  await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "saved-device");
  expect(await page.evaluate(() => (window as TestWindow).__c1CipherReads)).toBe(0);
  await page.clock.resume();
  // The invitation key is consumed from the fragment; reopening uses the saved recovery link.
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

test("leaving the Lab while recovery opens disposes the transport before its channel", async ({
  page,
  consoleErrors,
}) => {
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      const request = open.call(this, name, version);
      if (name === "livediagrams-collab-recovery-v1")
        Object.defineProperty(request, "onsuccess", {
          set(callback: () => void) {
            request.addEventListener(
              "success",
              () => {
                (window as TestWindow).__releaseRecoveryOpen = callback;
              },
              { once: true },
            );
          },
        });
      return request;
    };
    const close = BroadcastChannel.prototype.close;
    BroadcastChannel.prototype.close = function () {
      if (this.name.startsWith("livediagrams-lab/"))
        (window as TestWindow).__recoveryChannelsClosed = ((window as TestWindow).__recoveryChannelsClosed ?? 0) + 1;
      close.call(this);
    };
  });
  await gotoLab(page, "collab-c1a");
  await expect.poll(() => page.evaluate(() => typeof (window as TestWindow).__releaseRecoveryOpen)).toBe("function");
  await pauseClock(page);
  await page.getByTestId("lab-preset-link-nodes-states").click();
  await expect(page.getByTestId("lab-stage")).toHaveAttribute("data-preset", "nodes-states");
  await page.evaluate(() => (window as TestWindow).__releaseRecoveryOpen?.());
  await expect.poll(() => page.evaluate(() => (window as TestWindow).__recoveryChannelsClosed ?? 0)).toBeGreaterThan(0);
  await page.clock.runFor(40_000);
  expectNoErrors(consoleErrors);
});

test("remote stencil changes restore focus when the focused inspector control disappears", async ({
  browser,
  context,
  page,
  baseURL,
  consoleErrors,
}) => {
  const other = await browser.newContext({ baseURL });
  const b = await other.newPage();
  await relay([context, other], 131);
  try {
    await open(page);
    await open(b, true);
    await page.getByTestId("node-api").click();
    await page.getByTestId("inspector-section-node-simulation").click();
    const control = page.getByTestId("inspector-field-latencyMs");
    await expect(control).toBeVisible();
    await control.focus();
    await b.getByTestId("node-api").click();
    await b.getByTestId("inspector-field-stencil").click();
    await b.getByTestId("stencil-picker-search").fill("kafka topic");
    await b.getByTestId("context-menu-item-pick-stencil:kafka.topic").click();
    await expect(control).toHaveCount(0);
    await expect(page.getByTestId("node-api")).toBeVisible();
    await page.bringToFront();
    await expect(page.getByTestId("canvas-wrap")).toBeFocused();
    await expect(page.getByTestId("canvas-announce")).toContainText("A peer changed the properties");
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page
          .getByTestId(/^node-(web|api|orders|db)$/)
          .evaluateAll((els) => els.some((el) => document.activeElement?.contains(el))),
      )
      .toBe(true);
    await b.getByTestId("undo-button").click();
    await page.getByTestId("node-api").click();
    await expect(control).toBeVisible();
    await control.focus();
    await pauseClock(page);
    await b.getByTestId("inspector-field-stencil").click();
    await b.getByTestId("stencil-picker-search").fill("kafka topic");
    await b.getByTestId("context-menu-item-pick-stencil:kafka.topic").click();
    await expect(control).toHaveCount(0);
    // A user choosing another surviving control before the recovery frame keeps that focus.
    const survivor = page.getByTestId("inspector-field-label");
    await survivor.focus();
    await page.clock.runFor(32);
    await expect(survivor).toBeFocused();
    await page.clock.resume();
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("a room rejection is an accessible, actionable alert and a later valid edit recovers", async ({
  page,
  consoleErrors,
}) => {
  await open(page);
  await page.getByTestId("node-api").click();
  await page.getByTestId("inspector-section-node-properties").click();
  await page.getByTestId("inspector-prop-new").fill("k".repeat(256));
  await page.getByTestId("inspector-prop-add").click();
  const alert = page.getByTestId("collab-edit-refused");
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Your last change was undone");
  await expect(alert).toContainText("Shorten it and try again");
  await expect(page.getByTestId(`inspector-prop-remove-${"k".repeat(256)}`)).toHaveCount(0);
  await alert.evaluate((el) => {
    el.setAttribute("data-previous-alert", "true");
  });
  await page.getByTestId("inspector-prop-new").fill("j".repeat(256));
  await page.getByTestId("inspector-prop-add").click();
  await expect(alert).toContainText("Your last change was undone");
  await expect(alert).not.toHaveAttribute("data-previous-alert", "true");
  await page.getByTestId("inspector-prop-new").fill("region");
  await page.getByTestId("inspector-prop-add").click();
  await expect(page.getByTestId("inspector-prop-remove-region")).toBeVisible();
  await expect(alert).toHaveCount(0);
  expectNoErrors(consoleErrors);
});

test("pasting Private content stops sharing before the paste reaches peers or room recovery", async ({
  browser,
  context,
  page,
  baseURL,
  consoleErrors,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const other = await browser.newContext({ baseURL });
  const b = await other.newPage();
  await relay([context, other], 132);
  try {
    await open(page);
    await open(b, true);
    await page.evaluate(() =>
      navigator.clipboard.writeText(
        JSON.stringify({
          format: "diagrams/clip-v1",
          private: true,
          groups: [],
          edges: [],
          nodes: [{ id: "private-input", stencil: "service.go", label: "Device-only draft", x: 0, y: 0 }],
        }),
      ),
    );
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("Control+v");
    await expect(page.getByTestId("collab-edit-refused")).toContainText("Sharing stopped");
    const made = page.getByTestId(/^node-private-input-/);
    await expect(made).toContainText("Device-only draft");
    await expect(b.getByTestId(/^node-private-input-/)).toHaveCount(0);
    await name(page, "api", "Private follow-up edit");
    await page.getByTestId("undo-button").click();
    await expect(page.getByTestId("node-api")).toContainText("API");
    await expect(made).toBeVisible();
    await page.getByTestId("undo-button").click();
    await expect(made).toHaveCount(0);
    await expect(page.getByTestId("private-badge")).toBeVisible();
    await page.getByTestId("redo-button").click();
    await expect(made).toContainText("Device-only draft");
    await expect(b.getByTestId("node-api")).toContainText("API");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-status", "offline");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "false");
    const downloading = page.waitForEvent("download");
    await page.getByTestId("collab-save-copy").click();
    const stream = await (await downloading).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const copy = JSON.parse(Buffer.concat(chunks).toString()) as { private?: boolean; nodes: { label: string }[] };
    expect(copy.private).toBe(true);
    expect(copy.nodes.some((n) => n.label === "Device-only draft")).toBe(true);
    await page.reload();
    await expect(page.getByTestId("node-api")).toBeVisible();
    await expect(page.getByTestId(/^node-private-input-/)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

const boundaryDiagram = {
  format: "diagrams/v1" as const,
  title: "Boundary gestures",
  groups: [{ id: "cluster", label: "Cluster", x: 0, y: 0, width: 440, height: 300 }],
  nodes: [
    { id: "api", stencil: "service.go", label: "API", x: 40, y: 80, group: "cluster" },
    { id: "outside", stencil: "service.go", label: "Outside", x: 600, y: 80 },
  ],
  edges: [],
};

test("a room drop restores position, membership and boundary growth with one Undo", async ({
  context,
  page,
  consoleErrors,
}) => {
  await relay([context], 133, boundaryDiagram);
  await open(page);
  const node = page.getByTestId("node-api"),
    group = page.getByTestId("group-cluster");
  await node.click();
  await waitForStableViewport(page);
  const before = await bounds(node),
    boundary = await bounds(group);
  const scale = before.width / 220;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2 + 160 * scale, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await bounds(group)).height).toBeGreaterThan(boundary.height);
  await page.getByTestId("undo-button").click();
  await expect
    .poll(async () => {
      const now = await bounds(node),
        outside = await bounds(page.getByTestId("node-outside"));
      return Math.round((now.y - outside.y) / (now.width / 220));
    })
    .toBe(0);
  await expect
    .poll(async () => Math.round((await bounds(group)).height / ((await bounds(node)).width / 220)))
    .toBe(300);
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("cluster");
  // Leaving the boundary uses the toast's Undo, which must also restore the move.
  const start = await bounds(node);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 350 * scale, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("membership-undo")).toBeVisible();
  await page.getByTestId("membership-undo").click();
  await expect
    .poll(async () => {
      const now = await bounds(node),
        outside = await bounds(page.getByTestId("node-outside"));
      return Math.round((now.y - outside.y) / (now.width / 220));
    })
    .toBe(0);
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("cluster");
  expectNoErrors(consoleErrors);
});

test("a room resize and deferred membership adoption are one Undo step", async ({ context, page, consoleErrors }) => {
  await relay([context], 134, boundaryDiagram);
  await open(page);
  await page.getByTestId("group-label-cluster").click();
  await waitForStableViewport(page);
  const group = page.getByTestId("group-cluster"),
    before = await bounds(group);
  const handle = page.getByTestId("group-resize-cluster-bottom-right");
  const box = await bounds(handle);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + before.width, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("membership-undo")).toBeVisible();
  await page.getByTestId("fit-view-button").click();
  await waitForStableViewport(page);
  await page.getByTestId("node-outside").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("cluster");
  await page.getByTestId("undo-button").click();
  await expect
    .poll(async () =>
      Math.round((await bounds(group)).width / ((await bounds(page.getByTestId("node-outside"))).width / 220)),
    )
    .toBe(440);
  await page.getByTestId("node-outside").click();
  await expect(page.getByTestId("inspector-field-group")).toHaveValue("");
  expectNoErrors(consoleErrors);
});

test("privacy-only shutdown leaves Undo disabled until a local edit", async ({ context, page, consoleErrors }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  // This newer-model paste changes privacy first, then refuses insertion into this legacy diagram.
  // The document/snapshot stays identical throughout the privacy-only transition.
  await page.evaluate(() =>
    navigator.clipboard.writeText(
      JSON.stringify({
        format: "diagrams/clip-v2",
        planning: { revision: "p3-a1" },
        private: true,
        groups: [],
        edges: [],
        nodes: [{ id: "new-model", stencil: "service.go", label: "Not inserted", x: 0, y: 0 }],
      }),
    ),
  );
  await page.getByTestId("canvas-wrap").focus();
  await pauseClock(page);
  await page.keyboard.press("Control+v");
  await expect(page.getByTestId("collab-edit-refused")).toContainText("Sharing stopped");
  await expect(page.getByTestId(/^node-new-model-/)).toHaveCount(0);
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  await expect(page.getByTestId("redo-button")).toBeDisabled();
  await page.clock.resume();
  await name(page, "api", "Local edit after shutdown");
  await expect(page.getByTestId("undo-button")).toBeEnabled();
  await page.getByTestId("undo-button").click();
  await expect(page.getByTestId("node-api")).toContainText("API");
  await expect(page.getByTestId("undo-button")).toBeDisabled();
  await expect(page.getByTestId("private-badge")).toBeVisible();
  expectNoErrors(consoleErrors);
});

for (const abortAfter of [1, 2]) {
  test(`recovery transaction aborted after staged write ${abortAfter} reloads the last durable state`, async ({
    context,
    page,
    consoleErrors,
  }) => {
    await relay([context], 140 + abortAfter);
    await open(page);
    await name(page, "api", "Durable before interrupted append");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "true");
    await page.evaluate((after) => {
      const put = IDBObjectStore.prototype.put;
      let staged = 0;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
        const result = put.apply(this, args);
        if (this.transaction.db.name === "livediagrams-collab-recovery-v1" && ++staged === after) {
          const tx = this.transaction;
          result.addEventListener("success", () => tx.abort(), { once: true });
          IDBObjectStore.prototype.put = put;
        }
        return result;
      };
    }, abortAfter);
    await name(page, "api", "Interrupted undurable append");
    await expect(page.getByTestId("collab-recovery-problem")).toContainText("Could not save");
    await expect(page.getByTestId("node-api")).toContainText("Interrupted undurable append");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "false");
    // Do not close the session or flush before reload: lose everything outside IndexedDB.
    await page.reload();
    await expect(page.getByTestId("node-api")).toContainText("Durable before interrupted append");
    await expect(page.getByTestId("collab-room-status")).toHaveAttribute("data-saved", "true");
    expectNoErrors(consoleErrors);
  });
}

test("a peer edit between image export slices aborts with a retry toast and preserves scoped Undo", async ({
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
  const initial = demoDiagram();
  initial.nodes.push(
    ...Array.from({ length: 45 }, (_, i) => ({
      id: `service-${i}`,
      stencil: "service.go",
      label: `Service ${i}`,
      x: (i % 5) * 260,
      y: 250 + Math.floor(i / 5) * 120,
    })),
  );
  await relay([context, other], 163, initial);
  await context.addInitScript(() => {
    if (window.__collabC1) window.__collabC1.imageExport = true;
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  try {
    await open(page);
    await open(b, true);
    await name(page, "api", "My local API");
    await expect(b.getByTestId("node-api")).toContainText("My local API");
    // SVG paint preparation can yield at 0%, before cloning. Hold a continuation only after
    // the app reports clone progress, rather than assuming the first macrotask is a clone slice.
    await page.evaluate(() => {
      const NativeChannel = window.MessageChannel;
      const w = window as unknown as { __exportSliceHeld: boolean; __resumeExportSlice: () => void };
      w.__exportSliceHeld = false;
      window.MessageChannel = class extends NativeChannel {
        constructor() {
          super();
          const post = this.port2.postMessage.bind(this.port2);
          this.port2.postMessage = (message: unknown) => {
            // Let React commit the progress published before this yield, even on a slow machine.
            requestAnimationFrame(() => {
              const progress = Number(
                document.querySelector('[data-testid="toast-progress"]')?.getAttribute("aria-valuenow"),
              );
              if (!(progress > 0 && progress < 70)) {
                post(message);
                return;
              }
              window.MessageChannel = NativeChannel;
              w.__exportSliceHeld = true;
              w.__resumeExportSlice = () => post(message);
            });
          };
        }
      };
    });
    await page.getByTestId("collab-export-png").click();
    await page.waitForFunction(() => (window as unknown as { __exportSliceHeld: boolean }).__exportSliceHeld);
    const progress = Number(await page.getByTestId("toast-progress").getAttribute("aria-valuenow"));
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(70);
    await b.getByTestId("fit-view-button").click();
    await waitForStableViewport(b);
    await name(b, "db", "Database by peer during export");
    await expect(page.getByTestId("node-db")).toContainText("Database by peer during export");
    await page.evaluate(() => (window as unknown as { __resumeExportSlice: () => void }).__resumeExportSlice());
    await expect(page.getByTestId("toast")).toHaveAttribute("data-kind", "error");
    await expect(page.getByTestId("toast")).toContainText("Couldn't export the PNG. Try again");
    expect(downloads).toBe(0);
    await expect(page.getByTestId("export-header")).toHaveCount(0);
    await page.getByTestId("undo-button").click();
    await expect(b.getByTestId("node-api")).toContainText("API");
    await expect(b.getByTestId("node-api")).not.toContainText("My local");
    await expect(page.getByTestId("node-db")).toContainText("Database by peer during export");
    await page.getByTestId("redo-button").click();
    await expect(b.getByTestId("node-api")).toContainText("My local API");
    await expect(b.getByTestId("node-db")).toContainText("Database by peer during export");
    expectNoErrors(consoleErrors);
    expectNoErrors(errors);
  } finally {
    await other.close();
  }
});
