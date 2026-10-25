import { chunk } from "./chunk";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoErrors,
  pageLoadTimeout,
  pauseClock,
  waitForStableViewport,
  cameraJournal,
  cameraJournalMark,
  interactionLog,
  interactionJournalMark,
  viewportTransform,
  openShareChooser,
} from "./fixtures";
import { COLLAB_LIMITS } from "../../src/collab/limits";
import { RECONNECT_MS } from "../../src/collab/room/timing";
import { emulateTracker } from "./collab-tracker";

// Edit together in the app (collaboration plan E2): a room's life between two browsers, with real WebRTC between
// them over host candidates. The matchmaking tracker is emulated here, in the test runner (routeWebSocket on the
// app's own origin: no server, no public network), speaking the WebTorrent tracker protocol the transport uses.
// Selectors are data-testid only.

/** A tracker that is there but never answers: every socket to it closes at once (matchmaking unreachable). */
async function deadTracker(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__collabEndpoints = {
      trackers: [`${location.origin.replace(/^http/, "ws")}/__dead-tracker`],
      iceServers: [],
    };
  });
  await context.routeWebSocket(
    (url) => url.pathname === "/__dead-tracker",
    (ws) => void ws.close(),
  );
}

/** Counts the page's peer connections (none may exist before consent). */
async function countPeerConnections(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { RTCPeerConnection: new (...a: unknown[]) => object; __peerConnections: number };
    w.__peerConnections = 0;
    const Original = w.RTCPeerConnection;
    w.RTCPeerConnection = class extends Original {
      constructor(...args: unknown[]) {
        super(...args);
        w.__peerConnections++;
      }
    };
  });
}
const peerConnections = (page: Page) =>
  page.evaluate(() => (window as unknown as { __peerConnections: number }).__peerConnections);

async function rename(page: Page, id: string, value: string) {
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

/** The hosts of the trackers this page was given (window.__collabEndpoints), as the consent dialogs list them. */
const trackerHosts = (page: Page) =>
  page.evaluate(() => (window.__collabEndpoints?.trackers ?? []).map((url) => new URL(url).hostname).join(", "));

/** Starts a room on the open diagram (the event Share's row will send), through its consent dialog. */
async function startRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  const dialog = page.getByTestId("room-start-dialog");
  await expect(dialog).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("room-start-disclosure")).toContainText("Everyone in the room can see your IP address");
  // What this page's room contacts, whoever runs it: the endpoints this page has (one tracker, the test's own, on
  // this origin), by host; with none (tests without a tracker), that this copy has no collaboration servers.
  await expect(page.getByTestId("room-start-disclosure")).toContainText("The services below");
  const hosts = await trackerHosts(page);
  await expect(page.getByTestId("room-services")).toHaveText(
    hosts ? `Services: ${hosts}` : "This copy of Live Diagrams has no collaboration servers set up.",
  );
  await page.getByTestId("room-start-confirm").click();
  await expect(page.getByTestId("room-started-dialog")).toBeVisible();
  await expect(page.getByTestId("room-link-copy")).toBeFocused();
  const link = await page.getByTestId("room-link").inputValue();
  // A knock-to-join room (P5): the lobby's secret, then the host's public key (no epoch).
  expect(link).toMatch(/#room=v3\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  await page.getByTestId("room-started-done").click();
  return link;
}

/** Knock-to-join (P5): the host lets in whoever is at the door (a card under the chip: Admit). */
async function admit(host: Page) {
  await host.getByTestId("room-knock-admit").first().click({ timeout: pageLoadTimeout() });
}

const chip = (page: Page) => page.getByTestId("room-chip");

/** One of the room chip's menu items (Copy room link, Leave room, Retry, Show). */
async function roomAction(page: Page, item: "room-leave" | "room-retry" | "room-copy-link" | "room-show") {
  await chip(page).click();
  await expect(page.getByTestId("room-menu")).toBeVisible();
  await page.getByTestId(item).click();
}

/** The top bar's brand ("Live Diagrams") stays on one line: the room chip gives way first. */
async function expectBrandOnOneLine(page: Page) {
  const name = page.getByTestId("brand").locator("span");
  const lineHeight = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect((await name.boundingBox())?.height).toBeLessThan(lineHeight * 1.5);
  // ...and nothing in the top bar overflows for it.
  expect(await page.getByTestId("topbar").evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true);
}

test("two browsers start, join, edit both ways, reload and drop over an emulated tracker", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  // Two browsers (three pages), a reload or a wipe and its restart: heavy under CI load.
  test.slow();
  const other = await browser.newContext();
  try {
    const sockets = await emulateTracker([context, other]);
    await countPeerConnections(context);
    await countPeerConnections(other);
    await page.clock.install();
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    await expect(chip(page)).toHaveAttribute("data-state", "waiting");
    // The room keeps the creator's copy in Your diagrams: an example becomes one of your diagrams.
    await expect(page.getByTestId("example-badge")).toHaveCount(0);

    const guest = await other.newPage();
    const guestErrors: string[] = [];
    guest.on("pageerror", (e) => guestErrors.push(e.message));
    const before = sockets.opened;
    await guest.goto(link);
    await expect(guest.getByTestId("room-join-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(guest.getByTestId("room-join-decline")).toBeFocused();
    await expect.poll(() => new URL(guest.url()).hash).toBe("");
    // Consent first: no tracker socket and no peer connection before Join.
    expect(sockets.opened).toBe(before);
    expect(await peerConnections(guest)).toBe(0);
    await guest.getByTestId("room-join-accept").click();
    // At the door until the host lets them in: nothing of the room meanwhile.
    await expect(guest.getByTestId("room-connecting")).toHaveAttribute("data-knocking", "true", {
      timeout: pageLoadTimeout(),
    });
    await admit(page);
    await expect(guest.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(chip(guest)).toHaveAttribute("data-peers", "1");
    await expect(chip(page)).toHaveAttribute("data-peers", "1");
    await expect(chip(page)).toHaveAttribute("data-state", "here");
    await expect(chip(page)).toContainText("2 here");

    await rename(guest, "gateway", "Renamed by the guest");
    await expect(page.getByTestId("node-gateway")).toContainText("Renamed by the guest");
    await rename(page, "orders", "Renamed by the creator");
    await expect(guest.getByTestId("node-orders")).toContainText("Renamed by the creator");

    // A reload keeps the guest in the room (this tab only), without asking again, with the room's latest.
    await guest.reload();
    await expect(guest.getByTestId("node-orders")).toContainText("Renamed by the creator", {
      timeout: pageLoadTimeout(),
    });
    await expect(guest.getByTestId("room-join-dialog")).toHaveCount(0);
    await expect(chip(guest)).toHaveAttribute("data-peers", "1");
    await expect(chip(page)).toHaveAttribute("data-peers", "1");
    await rename(page, "gateway", "After the guest's reload");
    await expect(guest.getByTestId("node-gateway")).toContainText("After the guest's reload");
    await rename(guest, "orders", "Guest after reload");
    await expect(page.getByTestId("node-orders")).toContainText("Guest after reload");

    // A hard drop (the guest's browser goes, no goodbye): the creator keeps editing; presence lapses on its clock.
    await pauseClock(page);
    await other.close();
    await page.clock.fastForward(COLLAB_LIMITS.presenceTtlMs + COLLAB_LIMITS.presenceHeartbeatMs);
    await expect(chip(page)).toHaveAttribute("data-present", "0");
    await rename(page, "orders", "Kept after the drop");
    await expect(page.getByTestId("node-orders")).toContainText("Kept after the drop");
    expect(guestErrors).toEqual([]);
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("Leave keeps your copy in Your diagrams, and Don't join leaves nothing behind", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  const other = await browser.newContext();
  try {
    await emulateTracker([context, other]);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    const guest = await other.newPage();
    await guest.goto(link);
    await guest.getByTestId("room-join-decline").click();
    await expect(guest.getByTestId("room-join-dialog")).toHaveCount(0);
    expect(await guest.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("diagrams.")))).toEqual(
      [],
    );
    expect(
      await guest.evaluate(
        () => (JSON.parse(localStorage.getItem("diagrams.library.v1") ?? "{}").entries ?? []).length,
      ),
    ).toBe(0);
    await guest.reload();
    await expect(guest.getByTestId("room-join-dialog")).toHaveCount(0);
    await expect(guest.getByTestId("room-chip")).toHaveCount(0);

    await rename(page, "gateway", "Kept after leaving");
    await roomAction(page, "room-leave");
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByTestId("node-gateway")).toContainText("Kept after leaving");
    await page.reload();
    await expect(page.getByTestId("node-gateway")).toContainText("Kept after leaving", { timeout: pageLoadTimeout() });
    await expect(chip(page)).toHaveCount(0);
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("a damaged room link explains itself and contacts nothing", async ({ context, page, consoleErrors }) => {
  const sockets = await emulateTracker([context]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline#room=v1.0.damaged");
  await expect(page.getByTestId("room-link-problem")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("room-link-problem-message")).toContainText("damaged or incomplete");
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.getByTestId("room-link-problem-ok").click();
  await expect(page.getByTestId("node-gateway")).toBeVisible();
  expect(sockets.opened).toBe(0);
  expectNoErrors(consoleErrors);
});

/** Records in the recovery database: rooms, journal updates and metadata (the lifecycle marker aside). */
const recoveryRecords = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("livediagrams-collab-recovery-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const count = (store: string) =>
      new Promise<number>((resolve, reject) => {
        const r = db.transaction(store, "readonly").objectStore(store).count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const counts = { rooms: await count("rooms"), metadata: await count("metadata"), updates: await count("updates") };
    db.close();
    return counts;
  });

test("an aborted recovery wipe does not report success, and Retry clears it", async ({
  context,
  page,
  consoleErrors,
}) => {
  await emulateTracker([context]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await startRoom(page);
  await rename(page, "gateway", "Kept in a checkpoint");
  await expect.poll(() => recoveryRecords(page).then((r) => r.rooms)).toBe(1);
  // The clear transaction aborts once.
  await page.evaluate(() => {
    const clear = IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear = function (this: IDBObjectStore) {
      IDBObjectStore.prototype.clear = clear;
      this.transaction.abort();
      return clear.call(this);
    };
  });
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-clear-device").click();
  await page.getByTestId("clear-device-confirm").click();
  await expect(page.getByTestId("clear-device-error")).toBeVisible();
  await expect(page.getByTestId("clear-device-dialog-title")).toHaveText("Couldn't clear everything");
  await expect(page.getByTestId("clear-device-rest")).toHaveText("Everything else was cleared.");
  await expect(page.getByTestId("clear-device-list")).toHaveCount(0);
  await expect(page.getByTestId("toast")).toHaveCount(0);
  // Storage writes have stopped: no way back to editing (no Cancel, no close button, no Escape, no backdrop).
  await expect(page.getByTestId("clear-device-cancel")).toHaveCount(0);
  await expect(page.getByTestId("clear-device-dialog-close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await expect(page.getByTestId("clear-device-dialog")).toBeVisible();
  expect((await recoveryRecords(page)).rooms).toBe(1);
  await page.getByTestId("clear-device-retry").click();
  await expect(page.getByTestId("clear-device-dialog")).toHaveCount(0, { timeout: pageLoadTimeout() });
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  expect(await recoveryRecords(page)).toEqual({ rooms: 0, metadata: 0, updates: 0 });
  expectNoErrors(consoleErrors.filter((e) => !/AbortError/.test(e)));
});

test("a failed recovery wipe's Reload page restarts the app at its plain address, out of the room", async ({
  context,
  page,
}) => {
  await emulateTracker([context]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await startRoom(page);
  await expect(page.getByTestId("room-chip")).toBeVisible();
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open;
    // The recovery database exists but refuses to open: the wipe can't complete.
    IDBFactory.prototype.databases = async () => [{ name: "livediagrams-collab-recovery-v1", version: 4 }];
    IDBFactory.prototype.open = function (name: string, version?: number) {
      if (name !== "livediagrams-collab-recovery-v1") return open.call(this, name, version);
      return open.call(this, name, 0);
    };
  });
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-clear-device").click();
  await page.getByTestId("clear-device-confirm").click();
  await expect(page.getByTestId("clear-device-error")).toBeVisible();
  await page.getByTestId("clear-device-reload").click();
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("clear-device-dialog")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).search).not.toContain("example=kafka-order-pipeline");
  // The room this tab was in doesn't resume.
  await expect(page.getByTestId("room-chip")).toHaveCount(0);
  await expect(page.getByTestId("room-connecting")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("diagrams.collab.room.v1"))).toBeNull();
});

test("a copy that can't be saved holds the room's canvas behind a dialog: file copy, Try again", async ({
  context,
  page,
  consoleErrors,
}) => {
  await emulateTracker([context]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await startRoom(page);
  // Storage refuses the copy from before the edit on (the edit's debounced copy fails too, however slow the runner).
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    const w = window as unknown as { __restoreStorage: () => void };
    w.__restoreStorage = () => {
      Storage.prototype.setItem = setItem;
    };
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key.startsWith("diagrams.autosave.")) throw new DOMException("full", "QuotaExceededError");
      setItem.call(this, key, value);
    };
  });
  await rename(page, "gateway", "Unsaved room edit");
  await roomAction(page, "room-leave");
  const dialog = page.getByTestId("room-unsaved-dialog");
  await expect(dialog).toBeVisible();
  // One message: no storage toast pointing at File ▸ Save behind the modal.
  await expect(page.getByTestId("toast")).toHaveCount(0);
  await expect(page.getByTestId("room-unsaved-retry")).toBeFocused();
  await expect(page.getByTestId("room-unsaved-dialog-close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("node-gateway")).toContainText("Unsaved room edit");
  const downloading = page.waitForEvent("download");
  await page.getByTestId("room-unsaved-file").click();
  const chunks: Buffer[] = [];
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("Unsaved room edit");
  await page.getByTestId("room-unsaved-retry").click();
  await expect(page.getByTestId("room-unsaved-again")).toBeVisible();
  await page.evaluate(() => (window as unknown as { __restoreStorage: () => void }).__restoreStorage());
  await page.getByTestId("room-unsaved-retry").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("room-chip")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("node-gateway")).toContainText("Unsaved room edit", { timeout: pageLoadTimeout() });
  expectNoErrors(consoleErrors);
});

test("Clear everything stops the room's writers, an encryption started before it can't repopulate recovery, and an old link restores nothing", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  // Two browsers (three pages), a reload or a wipe and its restart: heavy under CI load.
  test.slow();
  const other = await browser.newContext();
  try {
    await emulateTracker([context, other]);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    await rename(page, "gateway", "Before the wipe");
    await expect.poll(() => recoveryRecords(page).then((r) => r.rooms)).toBe(1);

    // A second tab in the same browser, in the same room, that hasn't heard about the wipe yet (as a tab in another
    // process may not have): its own writes must still be refused afterwards.
    const late = await context.newPage();
    const lateErrors: string[] = [];
    late.on("pageerror", (e) => lateErrors.push(e.message));
    late.on("console", (m) => m.type() === "error" && lateErrors.push(m.text()));
    await late.addInitScript(() => {
      const born = localStorage.getItem("diagrams.generation");
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        return key === "diagrams.generation" ? born : get.call(this, key);
      };
      const NativeChannel = window.BroadcastChannel;
      window.BroadcastChannel = class extends NativeChannel {
        constructor(name: string) {
          super(name === "diagrams.generation" ? "deaf" : name);
        }
      };
      // Count the checkpoint writes it attempts.
      const w = window as unknown as { __recoveryWrites: number };
      w.__recoveryWrites = 0;
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof transaction>) {
        if (this.name === "livediagrams-collab-recovery-v1" && args[1] === "readwrite") w.__recoveryWrites++;
        return transaction.apply(this, args);
      } as typeof transaction;
      const listen = window.addEventListener;
      window.addEventListener = function (this: Window, ...args: Parameters<typeof listen>) {
        if (args[0] !== "storage") listen.apply(this, args);
      } as typeof listen;
    });
    // The guest supplies the room's diagram to the late tab; the late tab is a joiner in this browser.
    const guest = await other.newPage();
    await guest.goto(link);
    await guest.getByTestId("room-join-accept").click();
    await admit(page);
    await expect(guest.getByTestId("node-gateway")).toContainText("Before the wipe", { timeout: pageLoadTimeout() });
    await late.goto(link);
    await late.getByTestId("room-join-accept").click();
    await admit(page);
    await expect(late.getByTestId("node-gateway")).toContainText("Before the wipe", { timeout: pageLoadTimeout() });

    // An encryption started before Clear everything, in the late tab: held at its entry until after the wipe.
    expect(lateErrors).toEqual([]);
    await late.evaluate(() => {
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      const w = window as unknown as { __releaseRecovery: () => void; __recoveryHeld: number };
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      w.__releaseRecovery = release;
      w.__recoveryHeld = 0;
      crypto.subtle.encrypt = (async (algorithm: AesGcmParams, key: CryptoKey, data: BufferSource) => {
        const aad = algorithm.additionalData ? new TextDecoder().decode(algorithm.additionalData as ArrayBuffer) : "";
        if (aad.startsWith("livediagrams/collab/storage/")) {
          w.__recoveryHeld++;
          await held;
        }
        return encrypt(algorithm, key, data);
      }) as typeof crypto.subtle.encrypt;
    });
    const held = () => late.evaluate(() => (window as unknown as { __recoveryHeld: number }).__recoveryHeld);
    await rename(guest, "orders", "Pending at the wipe");
    await expect(late.getByTestId("node-orders")).toContainText("Pending at the wipe");
    await expect.poll(held).toBeGreaterThan(0);

    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-clear-device").click();
    await page.getByTestId("clear-device-confirm").click();
    await expect(page.getByTestId("room-chip")).toHaveCount(0, { timeout: pageLoadTimeout() });
    await expect.poll(() => recoveryRecords(late)).toEqual({ rooms: 0, metadata: 0, updates: 0 });

    // The held encryption completes in the still-open document: its write aborts against the wipe's marker.
    const attempts = () => late.evaluate(() => (window as unknown as { __recoveryWrites: number }).__recoveryWrites);
    const before = await attempts();
    await late.evaluate(() => (window as unknown as { __releaseRecovery: () => void }).__releaseRecovery());
    await expect.poll(attempts).toBeGreaterThan(before);
    expect(await recoveryRecords(late)).toEqual({ rooms: 0, metadata: 0, updates: 0 });

    // The late tab takes the room's later edits on; its checkpoint writes abort too.
    const after = await attempts();
    await rename(guest, "gateway", "Written after the wipe");
    await expect(late.getByTestId("node-gateway")).toContainText("Written after the wipe");
    await expect.poll(attempts).toBeGreaterThan(after);
    await expect.poll(() => recoveryRecords(late)).toEqual({ rooms: 0, metadata: 0, updates: 0 });
    expect(lateErrors).toEqual([]);
    await late.close();
    await guest.close();

    // The old link, opened again on this device, finds nothing kept here: it waits for a peer.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(link);
    await page.getByTestId("room-join-accept").click();
    await expect(page.getByTestId("room-connecting")).toBeVisible({ timeout: pageLoadTimeout() });
    // While connecting the chip is status only (the wait has Leave room), and it gives way before the brand wraps.
    await expect(chip(page)).toHaveAttribute("data-state", "connecting");
    await expect(page.getByTestId("room-copy-link")).toHaveCount(0);
    await expect(page.getByTestId("room-leave")).toHaveCount(0);
    await expectBrandOnOneLine(page);
    expect(await recoveryRecords(page)).toEqual({ rooms: 0, metadata: 0, updates: 0 });
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

// ---------------------------------------------------------------- E3: a peer's changes never move your view or focus

/** Two browsers in one room: the creator's page and a guest's, both showing the room's diagram. */
async function twoInARoom(page: Page, context: BrowserContext, other: BrowserContext) {
  await emulateTracker([context, other]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  const link = await startRoom(page);
  const guest = await other.newPage();
  await guest.goto(link);
  await expect(guest.getByTestId("room-services")).toHaveText(`Services: ${new URL(page.url()).hostname}`);
  await expect(guest.getByTestId("room-join-dialog")).toContainText("The services below");
  await guest.getByTestId("room-join-accept").click();
  await admit(page);
  await expect(guest.getByTestId("node-orders")).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(chip(page)).toHaveAttribute("data-peers", "1");
  return guest;
}

test("a peer deleting the right-clicked node closes the menu (remote), the canvas takes the keyboard, the view stays", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  const other = await browser.newContext();
  try {
    const guest = await twoInARoom(page, context, other);
    await waitForStableViewport(guest);
    const camera = await cameraJournalMark(guest);
    const view = await viewportTransform(guest);
    await guest.getByTestId("node-orders").click({ button: "right" });
    await expect(guest.getByTestId("context-menu")).toBeVisible();
    const focus = await interactionJournalMark(guest);
    await page.bringToFront();
    await page.getByTestId("node-orders").click();
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("node-orders")).toHaveCount(0);
    await expect(guest.getByTestId("node-orders")).toHaveCount(0);
    await expect(guest.getByTestId("context-menu")).toHaveCount(0);
    expect(await interactionLog(guest, focus)).toContain("menu.closed:remote -> focus:canvas@commit");
    await expect(guest.getByTestId("canvas-wrap")).toBeFocused();
    await expect(guest.getByTestId("canvas-announce")).toHaveText(
      "The element you were editing was removed by a peer.",
    );
    // A peer's rename and deletion moved nothing on the guest's side.
    await rename(page, "gateway", "Renamed by the creator");
    await expect(guest.getByTestId("node-gateway")).toContainText("Renamed by the creator");
    expect((await cameraJournal(guest, camera)).filter((e) => e.moved)).toEqual([]);
    expect(await viewportTransform(guest)).toBe(view);
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("joining hands the keyboard to the wait, then to the room's canvas, through the interaction controller", async ({
  browser,
  context,
  page,
}) => {
  const other = await browser.newContext();
  try {
    const guest = await twoInARoom(page, context, other);
    await expect(guest.getByTestId("canvas-wrap")).toBeFocused();
    const log = await interactionLog(guest);
    expect(log.some((line) => line.startsWith("dialog.closed:room ->"))).toBe(true);
    expect(log.some((line) => line.startsWith("room.waiting -> focus:element@now"))).toBe(true);
    expect(log.some((line) => line.startsWith("room.ready -> focus:canvas@frame"))).toBe(true);
  } finally {
    await other.close();
  }
});

test("a room dialog restores focus; an unconfigured room chip explains setup without Retry", async ({
  page,
  consoleErrors,
}) => {
  // No tracker at all (the e2e build contacts none without one): the room can't connect.
  await page.clock.install();
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("file-button").focus();
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-cancel").click();
  await expect(page.getByTestId("file-button")).toBeFocused();
  expect(await interactionLog(page)).toContain("dialog.closed:room -> focus:element@now");
  await page.setViewportSize({ width: 1280, height: 800 });
  await startRoom(page);
  await expect(chip(page)).toHaveAttribute("data-state", "waiting");
  await expectBrandOnOneLine(page);
  await pauseClock(page);
  await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
  await expect(chip(page)).toHaveAttribute("data-state", "failed");
  await chip(page).click();
  await expect(page.getByTestId("room-menu")).toBeVisible();
  await expect(page.getByTestId("room-retry")).toHaveCount(0);
  await expect(page.getByTestId("room-chip-no-servers")).toContainText("has no collaboration servers set up.");
  await expect(page.getByTestId("room-self-host-docs")).toHaveAttribute(
    "href",
    "https://github.com/latchkostov/diagrams/blob/master/docs/SELF-HOSTING.md",
  );
  await page.keyboard.press("Escape");
  await expect(chip(page)).toBeFocused();
  expectNoErrors(consoleErrors);
});

// ---------------------------------------------------------------- E4: Share's Edit together, the chip, failures

test("Share's Edit together, after Link with password and never first, starts a room from the open diagram", async ({
  context,
  page,
  consoleErrors,
}) => {
  await emulateTracker([context]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await openShareChooser(page);
  // The safest row has the keyboard; Edit together sits after Link with password, behind its own rule.
  await expect(page.getByTestId("share-option-html")).toBeFocused();
  const row = page.getByTestId("share-option-edit-together");
  await expect(row).toBeVisible();
  expect(
    await page.evaluate(() => {
      const password = document.querySelector('[data-testid="share-option-password"]');
      const room = document.querySelector('[data-testid="share-option-edit-together"]');
      return !!password && !!room && !!(password.compareDocumentPosition(room) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await expectAxeClean(page, "share-chooser");
  // The keyboard reaches it with the arrows.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await expectAxeClean(page, "room-start-dialog");
  await page.getByTestId("room-start-confirm").click();
  await expect(page.getByTestId("room-started-dialog")).toBeVisible();
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  await expect(chip(page)).toHaveAttribute("data-state", "waiting");
  // The chip's menu: who is here (you, by your name in the room), the link and Leave.
  await chip(page).click();
  await expect(page.getByTestId("room-person-you")).toContainText("You — Anonymous");
  await expectAxeClean(page, "room-menu");
  await page.getByTestId("room-copy-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  // Copying refused: the link in a dialog, selected.
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("blocked"));
    document.execCommand = () => false;
  });
  await roomAction(page, "room-copy-link");
  await expect(page.getByTestId("room-link-selectable")).toHaveValue(link);
  await expect(page.getByTestId("room-link-selectable")).toBeFocused();
  await page.getByTestId("room-link-dialog-done").click();
  await expect(chip(page)).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("Ctrl+K finds Edit together; a Private diagram has no room row and explains why", async ({ page }) => {
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("canvas-wrap").focus();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("collaborate");
  await page.getByTestId("command-item-file:edit-together").click();
  await expect(page.getByTestId("room-start-dialog")).toBeVisible({ timeout: pageLoadTimeout() });
  await page.getByTestId("room-start-cancel").click();
  // Private: File ▸ Privacy ▸ this diagram (an example becomes a private copy).
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-diagram").click();
  await expect(page.getByTestId("example-badge")).toHaveCount(0);
  await openShareChooser(page);
  await expect(page.getByTestId("share-option-edit-together")).toHaveCount(0);
  await expect(page.getByTestId("share-private-note")).toContainText(
    "Links, rooms and public embeds are off for a private diagram.",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByTestId("command-input").fill("edit together");
  await page.getByTestId("command-item-file:edit-together").click();
  await expect(page.getByTestId("room-private-off")).toContainText("off for a private diagram");
});

test("matchmaking unreachable: the alert says so, offers a file, and Retry keeps the keyboard on the chip", async ({
  context,
  page,
  consoleErrors,
}) => {
  await deadTracker(context);
  await page.clock.install();
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await startRoom(page);
  await pauseClock(page);
  await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
  const alert = page.getByTestId("room-alert");
  await expect(alert).toContainText("Could not connect to this room");
  await expect(alert).toContainText("You can send a diagram file instead");
  await expect(page.getByTestId("room-no-servers")).toHaveCount(0);
  await page.clock.resume();
  await expectAxeClean(page, "room-alert");
  const downloading = page.waitForEvent("download");
  await page.getByTestId("room-alert-file").click();
  const chunks: Buffer[] = [];
  for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("Commerce gateway");
  await page.getByTestId("room-alert-retry").click();
  await expect(alert).toHaveCount(0);
  await expect(chip(page)).toBeFocused();
  expectNoErrors(consoleErrors);
});

test("a build with no trackers says so plainly, to the one who starts a room and to a joiner", async ({
  browser,
  page,
  consoleErrors,
}) => {
  // No endpoints at all: the e2e build given none, as a copy built without any would be.
  const NO_SERVERS = "This copy of Live Diagrams has no collaboration servers set up.";
  const other = await browser.newContext();
  try {
    await page.clock.install();
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
    await expect(page.getByTestId("room-services")).toHaveText(NO_SERVERS);
    await page.getByTestId("room-start-confirm").click();
    const link = await page.getByTestId("room-link").inputValue();
    await page.getByTestId("room-started-done").click();
    await pauseClock(page);
    await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    const alert = page.getByTestId("room-alert");
    await expect(alert).toContainText(NO_SERVERS);
    await expect(alert).toContainText("VITE_COLLAB_TRACKERS");
    await expect(alert).not.toContainText("Could not connect");
    await expect(chip(page)).toContainText("No collaboration servers");
    await expect(page.getByTestId("room-alert-retry")).toHaveCount(0);
    await page.clock.resume();
    const download = page.waitForEvent("download");
    await page.getByTestId("room-alert-file").click();
    expect((await download).suggestedFilename()).toBe("room-copy.diagram.json");
    await chip(page).click();
    await expect(page.getByTestId("room-menu")).toBeVisible();
    await expect(page.getByTestId("room-retry")).toHaveCount(0);
    await expect(page.getByTestId("room-chip-no-servers")).toContainText(NO_SERVERS);
    await expect(page.getByTestId("room-self-host-docs")).toHaveText("Self-hosting guide");
    await expect(page.getByTestId("room-self-host-docs")).toHaveAttribute(
      "href",
      "https://github.com/latchkostov/diagrams/blob/master/docs/SELF-HOSTING.md",
    );
    await page.keyboard.press("Escape");
    await expectAxeClean(page, "room-alert");
    // A joiner of the same copy: told before joining, and again once the wait is over.
    const guest = await other.newPage();
    await guest.clock.install();
    await guest.goto(link);
    await expect(guest.getByTestId("room-services")).toHaveText(NO_SERVERS);
    await guest.getByTestId("room-join-accept").click();
    await expect(chip(guest)).toHaveAttribute("data-state", "connecting");
    await pauseClock(guest);
    await guest.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    const said = guest.getByTestId("room-connecting-failed");
    await expect(said).toHaveAttribute("data-reason", "no-trackers");
    await expect(said).toContainText(NO_SERVERS);
    await expect(said).not.toContainText("Could not connect");
    await expect(guest.getByTestId("room-connecting-retry")).toHaveCount(0);
    await expect(guest.getByTestId("room-alert-file")).toHaveCount(0);
    await expect(guest.getByTestId("room-connecting-file-hint")).toHaveText(
      "Ask the room's host to send a diagram file. No diagram has arrived on this page.",
    );
    await expect(guest.getByTestId("room-connecting-leave")).toBeEnabled();
    await guest.clock.resume();
    await expectAxeClean(guest, "room-connecting");
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("a peer that leaves shows Reconnecting…, then Everyone else left; a joiner nobody answers is told so", async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  const other = await browser.newContext();
  try {
    await page.clock.install();
    const guest = await twoInARoom(page, context, other);
    await roomAction(guest, "room-leave");
    await expect(chip(page)).toHaveAttribute("data-state", "reconnecting");
    await expect(chip(page)).toContainText("Reconnecting…");
    await pauseClock(page);
    await page.clock.runFor(RECONNECT_MS);
    await expect(chip(page)).toHaveAttribute("data-state", "alone");
    await expect(chip(page)).toContainText("Everyone else left");
  } finally {
    await other.close();
  }
});

test("a joiner nobody answers is told they may have left, with Retry", async ({ browser, context, page }) => {
  const other = await browser.newContext();
  try {
    await emulateTracker([context, other]);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    await roomAction(page, "room-leave");
    const guest = await other.newPage();
    await guest.clock.install();
    await guest.goto(link);
    await guest.getByTestId("room-join-accept").click();
    await expect(guest.getByTestId("room-connecting")).toBeVisible({ timeout: pageLoadTimeout() });
    // The room has opened (its chip shows): its attempt, and so its wait, has started.
    await expect(chip(guest)).toHaveAttribute("data-state", "connecting");
    await pauseClock(guest);
    await guest.clock.runFor(COLLAB_LIMITS.noAnswerMs);
    const said = guest.getByTestId("room-connecting-failed");
    await expect(said).toHaveAttribute("data-reason", "no-answer");
    await expect(said).toContainText("No one else is in this room right now");
    await guest.getByTestId("room-connecting-retry").click();
    await expect(guest.getByTestId("room-connecting")).toBeFocused();
    // Retry clears it and starts a fresh wait: gone at once, still gone just before the wait ends, then back.
    await expect(said).toHaveCount(0);
    await guest.clock.runFor(COLLAB_LIMITS.noAnswerMs - 1000);
    await expect(said).toHaveCount(0);
    await guest.clock.runFor(1000);
    await expect(said).toHaveAttribute("data-reason", "no-answer");
  } finally {
    await other.close();
  }
});

test("joining focuses the connecting status, then the canvas; focus moved to the toolbar stays there", async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  const other = await browser.newContext();
  const third = await browser.newContext();
  try {
    const tracker = await emulateTracker([context, other, third]);
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    const join = async (guest: Page) => {
      tracker.hold();
      await guest.goto(link);
      await guest.getByTestId("room-join-accept").click();
      // Opening the room (its code, keys and recovery) can take a while on a loaded runner.
      await expect(guest.getByTestId("room-connecting")).toBeVisible({ timeout: pageLoadTimeout() });
      await expect(guest.getByTestId("room-connecting")).toBeFocused();
    };
    const first = await other.newPage();
    await join(first);
    await first.keyboard.press("Tab");
    await expect(first.getByTestId("room-connecting-leave")).toBeFocused();
    tracker.release();
    // Knock-to-join: the host lets them in (on its own page: the guest's keyboard stays where it is).
    await admit(page);
    await expect(first.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(first.getByTestId("canvas-wrap")).toBeFocused();
    await first.close();
    // Focus moved to the toolbar during the wait stays there when the room's canvas arrives. Another browser: one
    // that has been in the room keeps its encrypted copy and needs no wait.
    const second = await third.newPage();
    await join(second);
    await second.getByTestId("file-button").focus();
    tracker.release();
    await admit(page);
    await expect(second.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect.poll(() => interactionLog(second)).toContainEqual(expect.stringMatching(/^room\.ready ->/));
    await expect(second.getByTestId("file-button")).toBeFocused();
  } finally {
    await other.close();
    await third.close();
  }
});

/** A peer (the creator) deletes what the guest's open context menu is for. */
async function deleteUnderMenu(page: Page, guest: Page, open: () => Promise<void>, remove: () => Promise<void>) {
  await open();
  await expect(guest.getByTestId("context-menu")).toBeVisible();
  const mark = await interactionJournalMark(guest);
  await page.bringToFront();
  await remove();
  await expect(guest.getByTestId("context-menu")).toHaveCount(0);
  expect(await interactionLog(guest, mark)).toContain("menu.closed:remote -> focus:canvas@commit");
  await expect(guest.getByTestId("canvas-wrap")).toBeFocused();
  await expect(guest.getByTestId("canvas-announce")).toContainText("removed by a peer");
}

test("remote boundary removal closes its context menu, and a selection menu holding a boundary", async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  const other = await browser.newContext();
  try {
    const guest = await twoInARoom(page, context, other);
    await waitForStableViewport(guest);
    const removeBoundary = async () => {
      await page.getByTestId("group-label-aks").click();
      await page.keyboard.press("Delete");
      await expect(page.getByTestId("group-aks")).toHaveCount(0);
    };
    await deleteUnderMenu(
      page,
      guest,
      () => guest.getByTestId("group-label-aks").click({ button: "right" }),
      removeBoundary,
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect(guest.getByTestId("group-aks")).toBeVisible();
    // A selection of a node and the boundary: its menu goes when the boundary does.
    await deleteUnderMenu(
      page,
      guest,
      async () => {
        await guest.bringToFront();
        await guest.getByTestId("group-label-aks").click();
        await waitForStableViewport(guest);
        await guest.getByTestId("node-gateway").click({ modifiers: ["Shift"] });
        await waitForStableViewport(guest);
        await guest.getByTestId("node-gateway").click({ button: "right" });
      },
      removeBoundary,
    );
  } finally {
    await other.close();
  }
});

/** axe (WCAG 2.x A and AA) on one test id's subtree. */
async function expectAxeClean(page: Page, scope: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .include(`[data-testid="${scope}"]`)
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("a Private paste whose Private mark fails reaches neither the peer nor the stored copy; its file copy is Private", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  test.slow();
  const other = await browser.newContext();
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const guest = await twoInARoom(page, context, other);
    // The entry's Private flag can't be written (storage full).
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
        if (key.startsWith("diagrams.library-entry.v1:")) throw new DOMException("full", "QuotaExceededError");
        setItem.call(this, key, value);
      };
      return navigator.clipboard.writeText(
        JSON.stringify({
          format: "diagrams/clip-v1",
          private: true,
          groups: [],
          edges: [],
          nodes: [{ id: "private-input", stencil: "service.go", label: "Device-only draft", x: 0, y: 0 }],
        }),
      );
    });
    await page.getByTestId("canvas-wrap").focus();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.getByTestId("room-unsaved-dialog")).toBeVisible();
    await expect(page.getByTestId(/^node-private-input/)).toContainText("Device-only draft");
    const downloading = page.waitForEvent("download");
    await page.getByTestId("room-unsaved-file").click();
    const chunks: Buffer[] = [];
    for await (const chunk of await (await downloading).createReadStream()) chunks.push(Buffer.from(chunk));
    const file = Buffer.concat(chunks).toString();
    expect(file).toContain("Device-only draft");
    expect(file).toContain('"private": true');
    await expect(guest.getByTestId(/^node-private-input/)).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes("Device-only draft")),
      ),
    ).toBe(false);
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("on a phone the room chip and its menu fit the screen", async ({ context, page }) => {
  await emulateTracker([context]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
  await startRoom(page);
  await expect(chip(page)).toBeVisible();
  await chip(page).click();
  for (const item of ["room-copy-link", "room-leave"] as const) {
    const box = await page.getByTestId(item).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
  }
  await page.getByTestId("room-leave").click();
  await expect(chip(page)).toHaveCount(0);
});

// ---------------------------------------------------------------- E5: presence

test("a peer's selection and cursor show in their colour and name; the view and the keyboard stay yours", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  test.slow();
  const other = await browser.newContext();
  try {
    await page.clock.install();
    const guest = await twoInARoom(page, context, other);
    await waitForStableViewport(page);
    await page.getByTestId("node-gateway").click();
    const focused = () => page.evaluate(() => document.activeElement?.closest("[data-id]")?.getAttribute("data-id"));
    const before = await focused();
    const camera = await cameraJournalMark(page);
    const view = await viewportTransform(page);
    // The guest selects a node and points at the canvas.
    await guest.bringToFront();
    await guest.getByTestId("node-orders").click();
    const box = await guest.getByTestId("canvas-wrap").boundingBox();
    if (!box) throw new Error("no canvas");
    await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await guest.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
    const outline = page.getByTestId("presence-outline-orders");
    await expect(outline).toBeVisible();
    const alias = await outline.getAttribute("data-peer");
    expect(alias).toMatch(/^Anonymous /);
    await expect(outline).toContainText(alias ?? "");
    // The ring itself: one, theirs, drawn in their colour.
    const ring = outline.getByTestId("presence-ring");
    await expect(ring).toHaveCount(1);
    await expect(ring).toHaveAttribute("data-peer", alias ?? "");
    const colour = await ring.evaluate((el) => getComputedStyle(el).getPropertyValue("--peer").trim());
    expect(colour).not.toBe("");
    expect(await ring.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    const cursor = page.getByTestId("presence-cursor");
    await expect(cursor).toBeVisible();
    await expect(cursor).toContainText(alias ?? "");
    // Nothing of the creator's moved: no camera command ran, the view and the keyboard are where they were.
    expect((await cameraJournal(page, camera)).filter((e) => e.moved)).toEqual([]);
    expect(await viewportTransform(page)).toBe(view);
    expect(await focused()).toBe(before);
    // Who is here: the guest by name, unverified.
    await chip(page).click();
    await expect(page.getByTestId("room-person")).toHaveCount(1);
    await expect(page.getByTestId("room-person")).toContainText(`${alias} (unverified)`);
    await page.keyboard.press("Escape");
    // A cursor that stays still hides after a while.
    await pauseClock(page);
    await page.clock.runFor(COLLAB_LIMITS.cursorIdleMs + 100);
    await expect(cursor).toHaveCount(0);
    await expect(outline).toBeVisible();
    await page.clock.resume();
    // A reload sends its goodbye at once: no second entry for the same person.
    await guest.reload();
    await expect(guest.getByTestId("node-orders")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(chip(page)).toHaveAttribute("data-peers", "1");
    await expect.poll(() => page.getByTestId("room-chip").getAttribute("data-present")).toBe("1");
    // Leaving: their outline goes, and the room says so quietly.
    await guest.getByTestId("node-orders").click();
    await expect(outline).toBeVisible();
    await roomAction(guest, "room-leave");
    await expect(outline).toHaveCount(0);
    await expect(page.getByTestId("room-announce")).toContainText("left.");
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("a joiner retrying from the chip keeps the keyboard on its wait; the alert stays below the bar, on the diagram only", async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  // Configured but unreachable trackers keep Retry relevant; neither side can connect.
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await deadTracker(context);
    await deadTracker(other);
    await page.clock.install();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(page.getByTestId("canvas-view")).toBeVisible({ timeout: pageLoadTimeout() });
    const link = await startRoom(page);
    await pauseClock(page);
    await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    const alert = page.getByTestId("room-alert");
    await expect(alert).toBeVisible();
    const bar = await page.getByTestId("topbar").boundingBox();
    const at = await alert.boundingBox();
    expect(bar && at && at.y >= bar.y + bar.height).toBe(true);
    await page.clock.resume();
    // On Stencils its actions would have nothing to act on: it isn't shown there.
    await page.getByTestId("view-gallery").click();
    await expect(alert).toHaveCount(0);
    // A joiner whose attempt failed retries from the chip's menu: the wait (not the page) keeps the keyboard.
    const guest = await other.newPage();
    await guest.clock.install();
    await guest.goto(link);
    await guest.getByTestId("room-join-accept").click();
    await expect(guest.getByTestId("room-connecting")).toBeVisible({ timeout: pageLoadTimeout() });
    await expect(chip(guest)).toHaveAttribute("data-state", "connecting");
    await pauseClock(guest);
    await guest.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    await expect(chip(guest)).toHaveAttribute("data-state", "failed");
    await roomAction(guest, "room-retry");
    await expect(guest.getByTestId("room-connecting")).toBeFocused();
  } finally {
    await other.close();
  }
});

test("others' outlines and pointers never show while presenting, printing or recording", async ({
  browser,
  context,
  page,
  consoleErrors,
}) => {
  test.slow();
  const other = await browser.newContext();
  try {
    const guest = await twoInARoom(page, context, other);
    await guest.getByTestId("node-orders").click();
    const box = await guest.getByTestId("canvas-wrap").boundingBox();
    if (!box) throw new Error("no canvas");
    await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.bringToFront();
    const ring = page.getByTestId("presence-ring");
    const cursor = page.getByTestId("presence-cursor");
    await expect(ring).toBeVisible();
    await expect(cursor).toBeVisible();
    // Presenting.
    await page.getByTestId("present-toggle").click();
    await expect(page.getByTestId("present-exit")).toBeVisible();
    await expect(page.getByTestId("presence-layer")).toBeHidden();
    await page.getByTestId("present-exit").click();
    await expect(page.getByTestId("present-exit")).toHaveCount(0);
    await expect(ring).toBeVisible();
    // Printing.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("presence-layer")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await expect(ring).toBeVisible();
    // Recording: the recorder marks what it frames (the canvas area, src/live/record) while it records.
    await page.getByTestId("canvas-wrap").evaluate((el) => el.setAttribute("data-lv-recording", ""));
    await expect(page.getByTestId("presence-layer")).toBeHidden();
    await page.getByTestId("canvas-wrap").evaluate((el) => el.removeAttribute("data-lv-recording"));
    await expect(ring).toBeVisible();
    expectNoErrors(consoleErrors);
  } finally {
    await other.close();
  }
});

test("an image export leaves out others' outlines, pointers and names", async ({ browser, context, page }) => {
  test.slow();
  const other = await browser.newContext();
  try {
    const guest = await twoInARoom(page, context, other);
    await guest.getByTestId("node-orders").click();
    const box = await guest.getByTestId("canvas-wrap").boundingBox();
    if (!box) throw new Error("no canvas");
    await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    const outline = page.getByTestId("presence-outline-orders");
    await expect(outline).toBeVisible();
    await expect(page.getByTestId("presence-cursor")).toBeVisible();
    const alias = (await outline.getAttribute("data-peer")) ?? "";
    expect(alias).not.toBe("");
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-more-formats").click();
    await page.getByTestId("export-image").click();
    await page.getByTestId("image-options-toggle").click();
    await page.getByTestId("image-format-svg").click();
    const downloading = page.waitForEvent("download");
    await page.getByTestId("image-export").click();
    const path = await (await downloading).path();
    if (!path) throw new Error("SVG download failed");
    const svg = await readFile(path, "utf8");
    expect(svg).toContain("Order service");
    expect(svg).not.toContain(alias);
    expect(svg).not.toContain("presence-");
  } finally {
    await other.close();
  }
});

test("P2 pending device wipe keeps the busy control focused and visibly disabled", async ({ page }) => {
  await page.goto("./?view=canvas&example=kafka-order-pipeline");
  await expect(page.getByTestId("node-gateway")).toBeVisible();
  await page.evaluate(() => {
    const held = Promise.withResolvers<IDBDatabaseInfo[]>();
    Object.assign(window, { __releaseWipe: () => held.resolve([]) });
    indexedDB.databases = () => held.promise;
  });
  await page.getByTestId("file-button").click();
  await page.getByTestId("file-privacy").click();
  await page.getByTestId("privacy-clear-device").click();
  await expect(page.getByTestId("clear-device-cancel")).toBeFocused();
  const confirm = page.getByTestId("clear-device-confirm");
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveAttribute("aria-busy", "true");
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await expect(confirm).not.toHaveAttribute("disabled");
  await expect(confirm).toBeFocused();
  await expect.poll(() => confirm.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.45");
  expect(await confirm.evaluate((el) => getComputedStyle(el).cursor)).toBe("not-allowed");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(confirm).toBeFocused();
  await expect(page.getByTestId("clear-device-cancel")).toHaveCount(0);
  await expect(page.getByTestId("clear-device-dialog-close")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __releaseWipe(): void }).__releaseWipe());
  await expect(page.getByTestId("clear-device-dialog")).toHaveCount(0);
});

test("P2 a peer deleting an edge announces why its menu closed", async ({ browser, context, page }) => {
  const other = await browser.newContext();
  try {
    const guest = await twoInARoom(page, context, other);
    const edgeId = await guest
      .getByTestId(/^edge-label-/)
      .first()
      .getAttribute("data-testid");
    if (!edgeId) throw new Error("Missing connection");
    await deleteUnderMenu(
      page,
      guest,
      () => guest.getByTestId(edgeId).click({ button: "right" }),
      async () => {
        await page.getByTestId(edgeId).click();
        await page.keyboard.press("Delete");
      },
    );
    await expect(guest.getByTestId("canvas-announce")).toHaveText(
      "The element you were editing was removed by a peer.",
    );
  } finally {
    await other.close();
  }
});

test("P2 peer deletion keeps rename canceled after the inspector loads", async ({ browser, context, page }) => {
  const other = await browser.newContext();
  const held = Promise.withResolvers<undefined>();
  let requested = false;
  await other.route(chunk("NodeIdentity", "src/canvas/inspector/NodeIdentity.tsx"), async (route) => {
    requested = true;
    await held.promise;
    await route.continue();
  });
  try {
    const guest = await twoInARoom(page, context, other);
    await waitForStableViewport(guest);
    await guest.getByTestId("node-orders").dblclick();
    await expect.poll(() => requested).toBe(true);
    await guest.keyboard.type("discarded");
    await page.bringToFront();
    await page.getByTestId("node-orders").click();
    await page.keyboard.press("Delete");
    await expect(guest.getByTestId("node-orders")).toHaveCount(0);
    await expect
      .poll(() => interactionLog(guest))
      .toContainEqual(expect.stringMatching(/^gone: focus:field:label@ready$/));
    await guest.bringToFront();
    await guest.keyboard.press("t");
    await expect(guest.getByTestId("annotation-editor")).toBeVisible();
    const loaded = guest.waitForResponse(chunk("NodeIdentity", "src/canvas/inspector/NodeIdentity.tsx"));
    held.resolve(undefined);
    const response = await loaded;
    await response.finished();
    await expect
      .poll(() => guest.evaluate(() => window.__lazySurfaces?.states()["inspector.identity"]?.state))
      .toBe("loaded");
    await expect(guest.getByTestId("inspector")).toHaveAttribute("data-inspector-mode", "text");
    await expect(guest.getByTestId("inspector-field-label")).toHaveCount(0);
    await expect(guest.getByTestId("annotation-editor")).toBeFocused();
    await guest.keyboard.type("Still editing");
    await expect(guest.getByTestId("annotation-editor")).toHaveValue("Still editing");
  } finally {
    held.resolve(undefined);
    await other.close();
  }
});
