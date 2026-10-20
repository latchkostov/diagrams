import type { BrowserContext, Page } from "@playwright/test";
import { once } from "node:events";
import { test, relayPreview } from "./collab-relay";
import { expect, pageLoadTimeout, waitForStableViewport, openShareChooser } from "./fixtures";
import { WebSocket } from "../../services/server/test/browser";
import { deriveRoomKeys } from "../../src/collab/keys";
import { parseRoomValue } from "../../src/collab/link";
import { RELAY_SUBPROTOCOL } from "../../src/collab/transport/relayProtocol";
import { COLLAB_LIMITS } from "../../src/collab/limits";

async function observe(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { RTCPeerConnection: typeof RTCPeerConnection; __rtc: number; __csp: string[] };
    w.__rtc = 0;
    w.__csp = [];
    const Original = w.RTCPeerConnection;
    w.RTCPeerConnection = class extends Original {
      constructor(config?: RTCConfiguration) {
        super(config);
        w.__rtc++;
      }
    };
    document.addEventListener("securitypolicyviolation", (event) => w.__csp.push(event.violatedDirective));
  });
}

async function start(page: Page, origin: string) {
  await page.goto(`${origin}/?view=canvas&example=kafka-order-pipeline`);
  await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
  await openShareChooser(page);
  await expect(page.getByTestId("share-option-password")).toHaveCount(0);
  await page.getByTestId("share-option-edit-together").click();
  await expect(page.getByTestId("room-start-disclosure")).toContainText(
    "This site's collaboration server (127.0.0.1) sees your IP address",
  );
  await expect(page.getByTestId("room-start-disclosure")).not.toContainText("Everyone in the room");
  await expect(page.getByTestId("room-services")).toHaveText("Services: 127.0.0.1");
  await page.getByTestId("room-start-confirm").click();
  const link = await page.getByTestId("room-link").inputValue();
  await page.getByTestId("room-started-done").click();
  return link;
}

test("relay: consent, two-way edits and same-origin CSP without WebRTC", async ({
  relayBuild,
  browser,
  context,
  page,
}) => {
  test.slow();
  const fixture = await relayPreview(relayBuild);
  const other = await browser.newContext();
  try {
    await observe(context);
    await observe(other);
    const link = await start(page, fixture.origin);
    const guest = await other.newPage();
    const sockets = fixture.relay.wss.clients.size;
    await guest.goto(link);
    await expect(guest.getByTestId("room-join-decline")).toBeFocused();
    await expect(guest.getByTestId("room-join-disclosure")).toContainText(
      "This site's collaboration server (127.0.0.1) will see your IP address",
    );
    await expect(guest.getByTestId("room-join-disclosure")).not.toContainText("Everyone in the room");
    await expect(guest.getByTestId("room-services")).toHaveText("Services: 127.0.0.1");
    expect(fixture.relay.wss.clients.size).toBe(sockets);
    await guest.getByTestId("room-join-accept").click();
    await page.getByTestId("room-knock-admit").first().click();
    await expect(guest.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    for (const [editor, receiver, label] of [
      [page, guest, "Relay canary"],
      [guest, page, "Return canary"],
    ] as const) {
      await editor.getByTestId("node-gateway").click();
      await waitForStableViewport(editor);
      await editor.getByTestId("inspector-field-label").fill(label);
      await editor.getByTestId("inspector-field-label").press("Enter");
      await expect(receiver.getByTestId("node-gateway")).toContainText(label);
    }
    for (const browserPage of [page, guest]) {
      expect(await browserPage.evaluate(() => (window as unknown as { __rtc: number }).__rtc)).toBe(0);
      expect(await browserPage.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    }
    const response = await page.request.get(fixture.origin);
    expect(response.headers()["content-security-policy"]).toContain("connect-src 'self';");
  } finally {
    await other.close();
    await page.goto("about:blank");
    await fixture.close();
  }
});

test("relay: full room and unreachable server explain why and offer Retry", async ({ relayBuild, context, page }) => {
  const fixture = await relayPreview(relayBuild);
  const occupants: WebSocket[] = [];
  try {
    await observe(context);
    await page.clock.install();
    const link = await start(page, fixture.origin);
    const keys = await deriveRoomKeys(parseRoomValue(new URL(link).hash.slice("#room=".length)));
    for (let i = 0; i < 7; i++) {
      const socket = new WebSocket(`${fixture.origin.replace("http:", "ws:")}/collab/v1`, RELAY_SUBPROTOCOL, {
        origin: fixture.origin,
      });
      occupants.push(socket);
      await once(socket, "open");
      const welcome = once(socket, "message");
      socket.send(JSON.stringify({ t: "hello", v: 1, room: keys.roomId }));
      await welcome;
    }
    await expect.poll(() => fixture.relay.rooms.get(keys.roomId)?.peers.size).toBe(8);
    // A ninth browser is refused while all eight slots are occupied.
    const guest = await context.newPage();
    await guest.clock.install();
    await guest.goto(link);
    const socketOpened = guest.waitForEvent("websocket");
    await guest.getByTestId("room-join-accept").click();
    const guestSocket = await socketOpened;
    await expect.poll(() => guestSocket.isClosed()).toBe(true);
    await expect(guest.getByTestId("room-connecting")).toHaveAttribute("data-connectivity", "room-full");
    await guest.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    await expect(guest.getByTestId("room-connecting-failed")).toContainText("This room is full.");
    await expect(guest.getByTestId("room-connecting-retry")).toBeVisible();
    for (const socket of occupants) socket.terminate();
    occupants.length = 0;
    await fixture.relay.close();
    await expect(page.getByTestId("room-chip")).toHaveAttribute("data-connectivity", "server-unreachable");
    await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    await expect(page.getByTestId("room-alert")).toContainText("Could not reach the collaboration server");
    await expect(page.getByTestId("room-alert-retry")).toBeVisible();
    await expect(page.getByTestId("room-alert-file")).toBeVisible();
    await guest.close();
  } finally {
    for (const socket of occupants) socket.terminate();
    await page.goto("about:blank");
    await fixture.close();
  }
});

test("relay: Private diagrams offer no room or privacy escape and contact no relay", async ({
  relayBuild,
  context,
  page,
}) => {
  const fixture = await relayPreview(relayBuild);
  try {
    await observe(context);
    await page.goto(`${fixture.origin}/?view=canvas&example=kafka-order-pipeline`);
    await expect(page.getByTestId("node-gateway")).toBeVisible({ timeout: pageLoadTimeout() });
    await page.getByTestId("file-button").click();
    await page.getByTestId("file-privacy").click();
    await page.getByTestId("privacy-diagram").click();
    await openShareChooser(page);
    await expect(page.getByTestId("share-option-edit-together")).toHaveCount(0);
    await expect(page.getByTestId("share-private-note")).toContainText("rooms");
    await expect(page.getByTestId("share-make-not-private")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("command-input").fill("edit together");
    await page.getByTestId("command-item-file:edit-together").click();
    await expect(page.getByTestId("room-private-off")).toContainText("off for a private diagram");
    await expect(page.getByTestId("room-start-confirm")).toHaveCount(0);
    expect(fixture.relay.wss.clients.size).toBe(0);
  } finally {
    await page.goto("about:blank");
    await fixture.close();
  }
});

test("relay: full room with custom capacity", async ({ relayBuild, context, page }) => {
  const fixture = await relayPreview(relayBuild, { LD_ROOM_CAP: "2" });
  let occupant: WebSocket | undefined;
  try {
    const link = await start(page, fixture.origin);
    const keys = await deriveRoomKeys(parseRoomValue(new URL(link).hash.slice("#room=".length)));
    occupant = new WebSocket(`${fixture.origin.replace("http:", "ws:")}/collab/v1`, RELAY_SUBPROTOCOL, {
      origin: fixture.origin,
    });
    await once(occupant, "open");
    const welcome = once(occupant, "message");
    occupant.send(JSON.stringify({ t: "hello", v: 1, room: keys.roomId }));
    await welcome;
    await expect.poll(() => fixture.relay.rooms.get(keys.roomId)?.peers.size).toBe(2);
    const guest = await context.newPage();
    await guest.clock.install();
    await guest.goto(link);
    await guest.getByTestId("room-join-accept").click();
    await expect(guest.getByTestId("room-connecting")).toHaveAttribute("data-connectivity", "room-full");
    await guest.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    await expect(guest.getByTestId("room-connecting-explanation")).toHaveText("This room is full.");
    await expect(guest.getByTestId("room-connecting-failed")).not.toContainText(/8|eight/);
    await guest.close();
  } finally {
    occupant?.terminate();
    await page.goto("about:blank");
    await fixture.close();
  }
});

test("relay: server at capacity does not claim an empty room is full", async ({ relayBuild, page }) => {
  const fixture = await relayPreview(relayBuild, { LD_MAX_ROOMS: "1" });
  let occupant: WebSocket | undefined;
  try {
    occupant = new WebSocket(`${fixture.origin.replace("http:", "ws:")}/collab/v1`, RELAY_SUBPROTOCOL, {
      origin: fixture.origin,
    });
    await once(occupant, "open");
    const welcome = once(occupant, "message");
    occupant.send(JSON.stringify({ t: "hello", v: 1, room: "A".repeat(43) }));
    await welcome;
    await page.clock.install();
    await start(page, fixture.origin);
    await expect(page.getByTestId("room-chip")).toHaveAttribute("data-connectivity", "server-full");
    await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    await expect(page.getByTestId("room-alert")).toContainText(
      "The collaboration server is at capacity. Try again later.",
    );
    await expect(page.getByTestId("room-alert")).not.toContainText("someone leaves");
  } finally {
    occupant?.terminate();
    await page.goto("about:blank");
    await fixture.close();
  }
});
