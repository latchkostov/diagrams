import type { Page } from "@playwright/test";
import { test, expect, expectNoErrors, gotoCanvas, gotoLab, waitForStableViewport } from "./fixtures";

// Collaboration C0 (docs/research/collaboration.md; src/collab). Two promises, in the browser:
//  1. Local use makes no network requests: editing never contacts anything, never opens a socket or a peer
//     connection, and never even loads the collaboration code (Yjs marks the page when it's imported).
//  2. The Lab's three-client room converges in a real browser (WebCrypto included) over the in-memory network,
//     through a partition, with nothing leaving the page. The public-matchmaking spike is never pressed here.
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
  const requests: string[] = [];
  const sockets: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("websocket", (ws) => sockets.push(ws.url()));
  return {
    async expectNothingLeft() {
      const origin = new URL(page.url()).origin;
      const host = new URL(page.url()).host;
      expect(requests.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin)).toEqual([]);
      // The dev server's own hot-reload socket is the only one allowed (and only on the dev server).
      expect(sockets.filter((u) => new URL(u).host !== host)).toEqual([]);
      expect(await page.evaluate(() => (window as unknown as { __peerConnections: number }).__peerConnections)).toBe(0);
    },
    loadedCollab: () => requests.some((u) => /[/\\]collab[/\\]|CollabDemo|yjs/i.test(u)),
  };
}

const yjsLoaded = (page: Page) => page.evaluate(() => "__ $YJS$ __" in window);

test("local use makes no network requests and never loads the collaboration code", async ({ page, consoleErrors }) => {
  const net = await watchNetwork(page);
  await gotoCanvas(page, "kafka-order-pipeline");
  await waitForStableViewport(page);
  // Edit: rename a node in its property sheet, then undo it.
  await page.getByTestId("node-order-events").dblclick();
  await expect(page.getByTestId("inspector-field-label")).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Renamed locally");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("node-order-events")).toContainText("Renamed locally");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("node-order-events")).not.toContainText("Renamed locally");
  await net.expectNothingLeft();
  expect(net.loadedCollab()).toBe(false);
  expect(await yjsLoaded(page)).toBe(false);
  expectNoErrors(consoleErrors);
});

test.describe("collaboration Lab (in-memory network)", () => {
  const count = (page: Page, name: string) => page.getByTestId(`collab-${name}-nodes`);

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
