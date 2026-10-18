import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";
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
} from "./fixtures";
import { COLLAB_LIMITS } from "../../src/collab/limits";

// Edit together in the app (collaboration plan E2): a room's life between two browsers, with real WebRTC between
// them over host candidates. The matchmaking tracker is emulated here, in the test runner (routeWebSocket on the
// app's own origin: no server, no public network), speaking the WebTorrent tracker protocol the transport uses.
// Selectors are data-testid only.

const TRACKER_PATH = "/__test-tracker";

/** One emulated tracker shared by every context given: swarms by info hash, offers and answers forwarded. */
async function emulateTracker(contexts: BrowserContext[]) {
  const swarms = new Map<string, Map<string, WebSocketRoute>>();
  const sockets = { opened: 0 };
  for (const context of contexts) {
    await context.addInitScript((path) => {
      window.__collabEndpoints = { trackers: [`${location.origin.replace(/^http/, "ws")}${path}`], iceServers: [] };
    }, TRACKER_PATH);
    await context.routeWebSocket(
      (url) => url.pathname === TRACKER_PATH,
      (ws) => {
        sockets.opened++;
        ws.onMessage((raw) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(String(raw)) as Record<string, unknown>;
          } catch {
            return;
          }
          if (msg.action !== "announce" || typeof msg.info_hash !== "string" || typeof msg.peer_id !== "string") return;
          const hash = msg.info_hash;
          const swarm = swarms.get(hash) ?? new Map<string, WebSocketRoute>();
          swarms.set(hash, swarm);
          if (msg.event === "stopped") {
            swarm.delete(msg.peer_id);
            return;
          }
          swarm.set(msg.peer_id, ws);
          if (msg.answer) {
            swarm.get(String(msg.to_peer_id))?.send(
              JSON.stringify({
                action: "announce",
                info_hash: hash,
                peer_id: msg.peer_id,
                offer_id: msg.offer_id,
                answer: msg.answer,
              }),
            );
            return;
          }
          ws.send(JSON.stringify({ action: "announce", info_hash: hash, interval: 120, complete: 0, incomplete: 0 }));
          const offers = (msg.offers as { offer_id: string; offer: unknown }[] | undefined) ?? [];
          const others = [...swarm].filter(([id]) => id !== msg.peer_id);
          others.slice(0, offers.length).forEach(([, peer], i) =>
            peer.send(
              JSON.stringify({
                action: "announce",
                info_hash: hash,
                peer_id: msg.peer_id,
                offer_id: offers[i].offer_id,
                offer: offers[i].offer,
              }),
            ),
          );
        });
        ws.onClose(() => {
          for (const swarm of swarms.values()) for (const [id, s] of swarm) if (s === ws) swarm.delete(id);
        });
      },
    );
  }
  return sockets;
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

/** Starts a room on the open diagram (the event Share's row will send), through its consent dialog. */
async function startRoom(page: Page): Promise<string> {
  await page.evaluate(() => window.dispatchEvent(new Event("diagrams:edit-together")));
  const dialog = page.getByTestId("room-start-dialog");
  await expect(dialog).toBeVisible({ timeout: pageLoadTimeout() });
  await expect(page.getByTestId("room-start-disclosure")).toContainText("Everyone in the room can see your IP address");
  await page.getByTestId("room-start-confirm").click();
  await expect(page.getByTestId("room-started-dialog")).toBeVisible();
  await expect(page.getByTestId("room-link-copy")).toBeFocused();
  const link = await page.getByTestId("room-link").inputValue();
  expect(link).toMatch(/#room=v1\.0\.[A-Za-z0-9_-]{43}$/);
  await page.getByTestId("room-started-done").click();
  return link;
}

const chip = (page: Page) => page.getByTestId("room-chip");

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
    await page.getByTestId("room-leave").click();
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
  await rename(page, "gateway", "Unsaved room edit");
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
  await page.getByTestId("room-leave").click();
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
    await expect(guest.getByTestId("node-gateway")).toContainText("Before the wipe", { timeout: pageLoadTimeout() });
    await late.goto(link);
    await late.getByTestId("room-join-accept").click();
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
  await guest.getByTestId("room-join-accept").click();
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

test("a room dialog gives focus back to what opened it; Retry hands it to the room's status", async ({
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
  await page.getByTestId("room-retry").click();
  await expect(chip(page)).not.toHaveAttribute("data-state", "failed");
  await expect(chip(page)).toBeFocused();
  expectNoErrors(consoleErrors);
});
