import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors, gotoCanvas, gotoLab, waitForStableViewport, pauseClock } from "./fixtures";
import { COLLAB_LIMITS } from "../../src/collab/limits";

// Collaboration C0 (docs/research/collaboration.md; src/collab). Two promises, in the browser:
//  1. Local use makes no network requests: editing never contacts anything, never opens a socket or a peer
//     connection, and never even loads the collaboration code (Yjs marks the page when it's imported).
//  2. The Lab's three-client room converges in a real browser (WebCrypto included) over the in-memory network,
//     through a partition, with nothing leaving the page. The public spike uses only a never-opening fake socket.
// Selectors are data-testid only.

/** Counts peer connections the page makes, and records every request and socket. */
async function watchNetwork(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { RTCPeerConnection?: new (...a: unknown[]) => object; __peerConnections: number };
    w.__peerConnections = 0;
    const Original = w.RTCPeerConnection;
    if (Original)
      w.RTCPeerConnection = class extends Original {
        constructor(...args: unknown[]) {
          super(...args);
          w.__peerConnections++;
        }
      };
  });
  const requests: { method: string; url: string }[] = [];
  const sockets: string[] = [];
  page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
  page.on("websocket", (ws) => sockets.push(ws.url()));
  /** The Vite dev server's own hot-reload socket (`ws://<app host>/?token=…`): the one socket allowed, in dev only. */
  const hmr = (u: string, host: string) => {
    const url = new URL(u);
    return url.host === host && url.pathname === "/" && url.searchParams.has("token");
  };
  const violations = async () => {
    const origin = new URL(page.url()).origin;
    const host = new URL(page.url()).host;
    const web = requests.filter((r) => /^https?:/.test(r.url));
    return [
      // Loading the app's own files only: nothing sent anywhere, nothing fetched from anyone else.
      ...web.filter((r) => new URL(r.url).origin !== origin).map((r) => `outside: ${r.method} ${r.url}`),
      ...web.filter((r) => r.method !== "GET").map((r) => `upload: ${r.method} ${r.url}`),
      ...sockets.filter((u) => !hmr(u, host)).map((u) => `socket: ${u}`),
      ...((await page.evaluate(() => (window as unknown as { __peerConnections: number }).__peerConnections)) > 0
        ? ["a peer connection"]
        : []),
    ];
  };
  return {
    violations,
    async expectNothingLeft() {
      expect(await violations()).toEqual([]);
    },
    loadedCollab: () => requests.some(({ url: u }) => /[/\\]collab[/\\]|CollabDemo|yjs/i.test(u)),
  };
}

const yjsLoaded = (page: Page) => page.evaluate(() => "__ $YJS$ __" in window);

type SpikeSocket = { readyState: number; onopen: (() => void) | null };
type SpikeWindow = { __spikeSocketAttempts: number; __spikeSockets: SpikeSocket[] };

async function stallTracker(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as SpikeWindow & { WebSocket: unknown };
    w.__spikeSocketAttempts = 0;
    w.__spikeSockets = [];
    // Leave Vite's own HMR socket intact: only the matchmaking endpoint is stalled.
    const NativeSocket = window.WebSocket;
    w.WebSocket = new Proxy(NativeSocket, {
      construct(target, args: ConstructorParameters<typeof WebSocket>) {
        if (new URL(args[0]).hostname !== "tracker.invalid") return Reflect.construct(target, args);
        w.__spikeSocketAttempts++;
        const socket = {
          readyState: 0,
          onopen: null,
          onclose: null,
          onmessage: null,
          onerror: null,
          close() {
            this.readyState = 3;
          },
          send() {
            if (this.readyState !== 1) throw new Error("A stalled socket cannot send");
          },
        };
        w.__spikeSockets.push(socket);
        return socket;
      },
    });
  });
}

test("an unreachable matchmaking transport offers Retry and a file without losing the Lab edits", async ({ page }) => {
  await page.clock.install();
  await stallTracker(page);
  await gotoLab(page, "collab-c0");
  await page.getByTestId("collab-spike-new").click();
  await page.getByTestId("collab-spike-trackers").fill("wss://tracker.invalid");
  await page.getByTestId("collab-spike-connect").click();
  await expect(page.getByTestId("collab-spike-status")).toContainText("waiting");
  await page.getByTestId("collab-spike-title-input").fill("Keep my disconnected edits");
  await page.getByTestId("collab-spike-set-title").click();
  await expect(page.getByTestId("collab-spike-title")).toHaveAttribute("data-title", "Keep my disconnected edits");
  await pauseClock(page);
  await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
  await expect(page.getByTestId("collab-spike-connection-failed")).toContainText("Could not connect to this room");
  await page.getByTestId("collab-spike-retry").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("collab-spike-connection-failed")).toHaveCount(0);
  await expect(page.getByTestId("collab-spike-status")).toBeFocused();
  expect(
    await page.evaluate(() => (window as unknown as { __spikeSocketAttempts: number }).__spikeSocketAttempts),
  ).toBe(2);
  await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
  const downloading = page.waitForEvent("download");
  await page.getByTestId("collab-spike-save-copy").click();
  const stream = await (await downloading).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain("Keep my disconnected edits");
  await page.getByTestId("collab-spike-disconnect").click();
  await expect(page.getByTestId("collab-spike-status")).toHaveCount(0);
});

for (const focused of ["retry", "save-copy", "title-input"])
  test(`automatic matchmaking recovery preserves keyboard focus from ${focused}`, async ({ page, consoleErrors }) => {
    await page.clock.install();
    await stallTracker(page);
    await gotoLab(page, "collab-c0");
    await page.getByTestId("collab-spike-new").click();
    await page.getByTestId("collab-spike-trackers").fill("wss://tracker.invalid");
    await page.getByTestId("collab-spike-stun").fill("");
    await page.getByTestId("collab-spike-connect").click();
    await expect(page.getByTestId("collab-spike-status")).toBeVisible();
    await pauseClock(page);
    await page.clock.runFor(COLLAB_LIMITS.connectionWaitMs);
    await expect(page.getByTestId("collab-spike-connection-failed")).toBeVisible();
    await page.getByTestId(`collab-spike-${focused}`).focus();
    await page.evaluate(() => {
      const socket = (window as unknown as SpikeWindow).__spikeSockets.at(-1);
      if (!socket) throw new Error("Connect did not create a tracker socket");
      socket.readyState = 1;
      socket.onopen?.();
    });
    await expect(page.getByTestId("collab-spike-connection-failed")).toHaveCount(0);
    await expect(page.getByTestId(`collab-spike-${focused === "title-input" ? focused : "status"}`)).toBeFocused();
    await page.getByTestId("collab-spike-disconnect").click();
    await expect(page.getByTestId("collab-spike-status")).toHaveCount(0);
    expectNoErrors(consoleErrors);
  });

test("Disconnect and Connect retain this room's edited document without reseeding", async ({ page }) => {
  await stallTracker(page);
  await gotoLab(page, "collab-c0");
  await page.getByTestId("collab-spike-new").click();
  await page.getByTestId("collab-spike-trackers").fill("wss://tracker.invalid");
  await page.getByTestId("collab-spike-connect").click();
  await page.getByTestId("collab-spike-title-input").fill("Keep this room across reconnects");
  await page.getByTestId("collab-spike-set-title").click();
  await page.getByTestId("collab-spike-disconnect").click();
  await page.getByTestId("collab-spike-connect").click();
  await expect(page.getByTestId("collab-spike-title")).toHaveAttribute(
    "data-title",
    "Keep this room across reconnects",
  );
  await expect(page.getByTestId("collab-spike-set-title")).toBeEnabled();
  await page.getByTestId("collab-spike-title-input").fill("Still editable");
  await page.getByTestId("collab-spike-set-title").click();
  await expect(page.getByTestId("collab-spike-title")).toHaveAttribute("data-title", "Still editable");
  await page.getByTestId("collab-spike-disconnect").click();
  await page.getByTestId("collab-spike-new").click();
  await page.getByTestId("collab-spike-connect").click();
  await expect(page.getByTestId("collab-spike-title")).toHaveAttribute("data-title", "Orders pipeline");
  await page.getByTestId("collab-spike-disconnect").click();
});

test("local use makes no network requests and never loads the collaboration code", async ({ page, consoleErrors }) => {
  const net = await watchNetwork(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await waitForStableViewport(page);
  // Edit: rename a node in its property sheet, then undo it.
  await page.getByTestId("node-order-events").dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Renamed locally");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-order-events")).toContainText("Renamed locally");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+Z");
  await expect(page.getByTestId("node-order-events")).not.toContainText("Renamed locally");
  await net.expectNothingLeft();
  expect(net.loadedCollab()).toBe(false);
  expect(await yjsLoaded(page)).toBe(false);
  expectNoErrors(consoleErrors);
});

test("the network watcher itself catches a same-origin upload, a room socket and a peer connection", async ({
  page,
}) => {
  const net = await watchNetwork(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await page.evaluate(async () => {
    await fetch("./collab-upload-probe", { method: "POST", body: "x" }).catch(() => {});
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/room-probe`);
    ws.onerror = () => {};
    new RTCPeerConnection().close();
  });
  await expect.poll(async () => (await net.violations()).length).toBeGreaterThanOrEqual(3);
  const found = (await net.violations()).join(" | ");
  expect(found).toContain("upload: POST");
  expect(found).toContain("socket: ");
  expect(found).toContain("a peer connection");
});

test.describe("collaboration Lab (in-memory network)", () => {
  const count = (page: Page, name: string) => page.getByTestId(`collab-${name}-nodes`);

  test("client panels and status stay within the Lab after widening the Inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await gotoCanvas(page, "kafka-order-pipeline");
    await page.getByTestId("node-order-events").dblclick();
    await page.getByTestId("inspector-resize").press("End");
    await expect
      .poll(() => page.getByTestId("inspector").evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(640);
    await gotoLab(page, "collab-c0");
    await expect(page.getByTestId("collab-converged")).toHaveAttribute("data-converged", "true");

    for (const viewport of [1920, 1366]) {
      await page.setViewportSize({ width: viewport, height: 1000 });
      const stage = page.getByTestId("lab-stage");
      await expect.poll(() => stage.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const stageBox = await stage.boundingBox();
      if (!stageBox) throw new Error("Lab stage is missing");
      for (const name of ["a", "b", "c"]) {
        const panel = page.getByTestId(`collab-client-${name}`);
        const status = page.getByTestId(`collab-${name}-status`);
        await expect(status).toHaveText("connected");
        await status.scrollIntoViewIfNeeded();
        await expect(status).toBeInViewport();
        const panelBox = await panel.boundingBox();
        if (!panelBox) throw new Error(`Client ${name} panel is missing`);
        expect(panelBox.x).toBeGreaterThanOrEqual(stageBox.x);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
        expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await page.getByTestId("collab-converged").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("collab-converged")).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath(`collaboration-${viewport}.png`) });
    }
  });

  test("three clients converge, through a partition, with nothing leaving the page", async ({
    page,
    consoleErrors,
  }) => {
    const net = await watchNetwork(page);
    await gotoLab(page, "collab-c0");
    await expect(page.getByTestId("collab-lab")).toBeVisible();
    for (const name of ["a", "b", "c"]) {
      await expect(page.getByTestId(`collab-${name}-status`)).toHaveText("connected");
      await expect(count(page, name)).toHaveAttribute("data-count", "4");
    }
    await expect(page.getByTestId("collab-converged")).toHaveAttribute("data-converged", "true");

    // B adds a node: everyone sees it.
    await page.getByTestId("collab-b-add").click();
    for (const name of ["a", "b", "c"]) await expect(count(page, name)).toHaveAttribute("data-count", "5");

    // Partition C off; both sides edit; heal; anti-entropy merges.
    await page.getByTestId("collab-partition").click();
    await page.getByTestId("collab-a-rename").click();
    await page.getByTestId("collab-c-add").click();
    await expect(page.getByTestId("collab-b-title")).toHaveText("Renamed by A");
    await expect(page.getByTestId("collab-c-title")).not.toHaveText("Renamed by A");
    await expect(count(page, "c")).toHaveAttribute("data-count", "6");
    await expect(count(page, "a")).toHaveAttribute("data-count", "5");
    await page.getByTestId("collab-partition").click();
    await page.getByTestId("collab-advance").click();
    for (const name of ["a", "b", "c"]) {
      await expect(count(page, name)).toHaveAttribute("data-count", "6");
      await expect(page.getByTestId(`collab-${name}-title`)).toHaveText("Renamed by A");
    }
    await expect(page.getByTestId("collab-converged")).toHaveAttribute("data-converged", "true");

    // Undo is per person: C undoes its own add, A's rename stays.
    await page.getByTestId("collab-c-undo").click();
    for (const name of ["a", "b", "c"]) {
      await expect(count(page, name)).toHaveAttribute("data-count", "5");
      await expect(page.getByTestId(`collab-${name}-title`)).toHaveText("Renamed by A");
    }

    // A copy made Private leaves the room: its later edits go nowhere.
    await page.getByTestId("collab-b-private").click();
    await expect(page.getByTestId("collab-b-status")).toHaveText("left");
    await expect(page.getByTestId("collab-b-add")).toBeDisabled();

    // Presence over the encrypted channel: A sees C, not B (B said goodbye).
    await expect(page.getByTestId("collab-a-peers")).toContainText("c (active)");
    await expect(page.getByTestId("collab-a-peers")).not.toContainText("b (");

    await net.expectNothingLeft();
    expectNoErrors(consoleErrors);
  });
});
