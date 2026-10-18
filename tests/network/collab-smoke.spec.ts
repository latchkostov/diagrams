import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { COLLAB_STUN, COLLAB_TRACKERS } from "../../src/collab/transport/tracker";

// Collaboration's Nightly network smoke (collaboration plan §4.2, E6): report-only, never in pull requests (its
// Playwright project exists only with COLLAB_SMOKE=1). Two browsers start and join a room through the product's own
// path (File ▸ Share… ▸ Edit together…, then the link) over the approved public trackers and Cloudflare STUN only,
// then check the document syncs both ways, presence shows, and Leave works. It records the time to connect and the
// selected candidate pair, and classifies a failure: the trackers unreachable, ICE/NAT (found but couldn't connect)
// or an app error, so a bad night on the public network reads differently from a bug. scripts/collab-smoke.mjs
// turns the result into the Nightly summary and its trend.
//
// The e2e build contacts no public service unless a test names the endpoints (src/collab/room/endpoints.ts): this
// spec names exactly the approved set. Until the production switch (E7) adds them to connect-src, the pages bypass
// the build's CSP; E7 removes that.

const RESULT = process.env.COLLAB_SMOKE_RESULT ?? "tests/.output/collab-smoke/result.json";
/** How long two browsers may take to find each other through the public trackers. */
const CONNECT_MS = 180_000;

type Stage = "load" | "start" | "join" | "connect" | "sync" | "presence" | "leave" | "done";
type FailureClass = "tracker-unreachable" | "ice-nat" | "app-error";

interface Result {
  ok: boolean;
  stage: Stage;
  class?: FailureClass;
  connectMs?: number;
  syncMs?: { creatorToJoiner?: number; joinerToCreator?: number };
  pair?: { local?: string; remote?: string; protocol?: string };
  trackers: Record<string, { opened: number; framesReceived: number }>;
  connectivity: { creator?: string; joiner?: string };
  errors: string[];
  message?: string;
  at: string;
  sha?: string;
}

test.describe.configure({ mode: "serial" });
test.setTimeout(6 * 60_000);
test.use({ bypassCSP: true });

/** A browser context that names the approved endpoints, keeps its peer connections for getStats, and logs sockets. */
async function context(browser: Browser, result: Result, role: "creator" | "joiner") {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    bypassCSP: true,
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript(
    (endpoints) => {
      const w = window as unknown as {
        __collabEndpoints: unknown;
        __pcs: RTCPeerConnection[];
        RTCPeerConnection: typeof RTCPeerConnection;
      };
      w.__collabEndpoints = endpoints;
      w.__pcs = [];
      const Native = w.RTCPeerConnection;
      w.RTCPeerConnection = class extends Native {
        constructor(config?: RTCConfiguration) {
          super(config);
          w.__pcs.push(this);
        }
      };
    },
    { trackers: COLLAB_TRACKERS, iceServers: COLLAB_STUN },
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => result.errors.push(`${role}: ${e.message}`));
  page.on("websocket", (ws) => {
    const host = new URL(ws.url()).host;
    const t = (result.trackers[host] ??= { opened: 0, framesReceived: 0 });
    t.opened++;
    ws.on("framereceived", () => t.framesReceived++);
  });
  return { ctx, page };
}

/** The selected candidate pair's types (host, srflx, prflx, relay) from the joiner's peer connections. */
async function selectedPair(page: Page): Promise<Result["pair"]> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs;
    for (const pc of pcs) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      const all = [...stats.values()] as Record<string, unknown>[];
      const pair = all.find((s) => s.type === "candidate-pair" && s.state === "succeeded" && s.nominated);
      if (!pair) continue;
      const local = all.find((s) => s.id === pair.localCandidateId);
      const remote = all.find((s) => s.id === pair.remoteCandidateId);
      return {
        local: String(local?.candidateType ?? ""),
        remote: String(remote?.candidateType ?? ""),
        protocol: String(local?.protocol ?? ""),
      };
    }
    return undefined;
  });
}

async function rename(page: Page, id: string, value: string) {
  await page.bringToFront();
  await page.getByTestId(`node-${id}`).dblclick();
  const field = page.getByTestId("inspector-field-label");
  await expect(field).toBeFocused();
  await field.fill(value);
  await field.press("Enter");
}

/** How long until `check` passes (ms), or a failure after `timeout`. */
async function timed(check: () => Promise<void>): Promise<number> {
  const start = Date.now();
  await check();
  return Date.now() - start;
}

/** Why it failed, from what each side's room says and what the trackers did. */
function classify(result: Result): FailureClass {
  if (result.errors.length || !["connect"].includes(result.stage)) return "app-error";
  const states = [result.connectivity.creator, result.connectivity.joiner];
  if (states.some((s) => s === "ice-failed" || s === "no-answer")) return "ice-nat";
  const answered = Object.values(result.trackers).some((t) => t.framesReceived > 0);
  if (!answered || states.some((s) => s === "trackers-unreachable")) return "tracker-unreachable";
  // Trackers answered but no peer ever connected: matchmaking found no one, or the connection never formed.
  return "ice-nat";
}

test("two browsers edit one room together over the public trackers", async ({ browser }) => {
  const result: Result = {
    ok: false,
    stage: "load",
    trackers: {},
    connectivity: {},
    errors: [],
    at: new Date().toISOString(),
    sha: process.env.GITHUB_SHA,
  };
  const creator = await context(browser, result, "creator");
  const joiner = await context(browser, result, "joiner");
  const a = creator.page;
  const b = joiner.page;
  try {
    await a.goto("./?view=canvas&example=kafka-order-pipeline");
    await expect(a.getByTestId("node-gateway")).toBeVisible({ timeout: 60_000 });

    result.stage = "start";
    await a.getByTestId("file-button").click();
    await a.getByTestId("file-share").click();
    await a.getByTestId("share-option-edit-together").click();
    await a.getByTestId("room-start-confirm").click();
    const link = await a.getByTestId("room-link").inputValue();
    await a.getByTestId("room-started-done").click();
    await expect(a.getByTestId("room-chip")).toBeVisible();

    result.stage = "join";
    await b.goto(link);
    await b.getByTestId("room-join-accept").click();

    result.stage = "connect";
    result.connectMs = await timed(() => expect(b.getByTestId("node-gateway")).toBeVisible({ timeout: CONNECT_MS }));
    result.pair = await selectedPair(b);
    await expect(a.getByTestId("room-chip")).toHaveAttribute("data-peers", "1", { timeout: 30_000 });

    result.stage = "sync";
    await rename(a, "gateway", "Renamed by the creator");
    const creatorToJoiner = await timed(() =>
      expect(b.getByTestId("node-gateway")).toContainText("Renamed by the creator", { timeout: 30_000 }),
    );
    await rename(b, "orders", "Renamed by the joiner");
    const joinerToCreator = await timed(() =>
      expect(a.getByTestId("node-orders")).toContainText("Renamed by the joiner", { timeout: 30_000 }),
    );
    result.syncMs = { creatorToJoiner, joinerToCreator };

    result.stage = "presence";
    await b.getByTestId("node-orders").click();
    await expect(a.getByTestId("presence-outline-orders")).toBeVisible({ timeout: 30_000 });

    result.stage = "leave";
    await b.getByTestId("room-chip").click();
    await b.getByTestId("room-leave").click();
    await expect(b.getByTestId("room-chip")).toHaveCount(0);
    await expect(a.getByTestId("room-chip")).toHaveAttribute("data-peers", "0", { timeout: 60_000 });
    await expect(a.getByTestId("presence-outline-orders")).toHaveCount(0);

    result.stage = "done";
    result.ok = result.errors.length === 0;
    expect(result.errors).toEqual([]);
  } catch (error) {
    result.message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw error;
  } finally {
    const read = async (page: Page) =>
      (await page
        .locator('[data-testid="room-chip"], [data-testid="room-connecting"]')
        .first()
        .getAttribute("data-connectivity", { timeout: 1_000 })
        .catch(() => null)) ?? undefined;
    result.connectivity = { creator: await read(a), joiner: await read(b) };
    if (!result.ok) result.class = classify(result);
    mkdirSync(dirname(RESULT), { recursive: true });
    writeFileSync(RESULT, JSON.stringify(result, null, 2));
    await creator.ctx.close();
    await joiner.ctx.close();
  }
});
