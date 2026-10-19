import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APPROVED_STUN, APPROVED_TRACKERS, readDeployment, trackerList } from "../../scripts/deployment-env";
import { COMMON_HEADERS, cspDirectives, securityHeadersFor, type CspOptions } from "../../scripts/security-headers";
import { formatRoomLink } from "./link";
import { seededBytes } from "./random";
import { deriveRoomKeys } from "./keys";
import { roomFor } from "./transport/conformance";
import { fakeEnvironment } from "./transport/fakeWebrtc";
import { COLLAB_STUN, COLLAB_TRACKERS, createTrackerTransport } from "./transport/tracker";

// What keeps a room's key out of other people's logs, and a room's public services to exactly the approved set.

describe("room keys never reach a server through the page's own requests", () => {
  it("sends no path or fragment cross-origin: Referrer-Policy is strict-origin-when-cross-origin (or stricter)", () => {
    // Browsers never put a fragment in Referer (Fetch: "strip url for use as a referrer"); this policy also keeps
    // the path and query from other origins. Stricter values would be fine; laxer ones (unsafe-url,
    // no-referrer-when-downgrade, origin-when-cross-origin) are not.
    expect(["strict-origin-when-cross-origin", "strict-origin", "same-origin", "no-referrer"]).toContain(
      COMMON_HEADERS["Referrer-Policy"],
    );
  });

  it("says the same in index.html, for copies served without the headers", () => {
    const html = readFileSync("index.html", "utf8");
    const meta = /<meta name="referrer" content="([^"]+)"/.exec(html)?.[1];
    expect(meta).toBe(COMMON_HEADERS["Referrer-Policy"]);
  });

  it("puts the key in the fragment only", () => {
    const url = new URL(formatRoomLink("https://www.livediagrams.dev/", { epoch: 0, secret: seededBytes(1)(32) }));
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/");
    expect(url.hash).toMatch(/^#room=v1\.0\.[A-Za-z0-9_-]{43}$/);
  });
});

const connect = (o: CspOptions) => cspDirectives(o).find(([name]) => name === "connect-src")![1];
const sockets = (o: CspOptions) => connect(o).filter((src) => /^wss?:/.test(src) || src === "*");

describe("a build with rooms reaches exactly the approved trackers; one without, none", () => {
  it("the build's default endpoints are the transport's: the two approved trackers, Cloudflare STUN, no TURN", () => {
    expect(APPROVED_TRACKERS).toEqual(COLLAB_TRACKERS);
    expect(APPROVED_STUN.map((urls) => ({ urls }))).toEqual(COLLAB_STUN);
    expect(readDeployment({}).collabTrackers).toEqual(COLLAB_TRACKERS);
    expect(readDeployment({}).collabIceServers).toEqual(COLLAB_STUN);
    expect(readDeployment({ VITE_ENABLE_COLLAB: "1" }).collabIceServers).toEqual(COLLAB_STUN);
  });

  it("every tracker URL the build accepts, in any spelling, is one the transport opens", async () => {
    const accepted = trackerList(
      "WSS://Tracker.Example.com, wss://t.example.com:8443/announce ws://localhost ws://127.0.0.1:8000 wss://t.example.com:8443/announce",
    );
    expect(accepted).toEqual([
      "wss://tracker.example.com/",
      "wss://t.example.com:8443/announce",
      "ws://localhost/",
      "ws://127.0.0.1:8000/",
    ]);
    const env = fakeEnvironment();
    const opened: string[] = [];
    const WS = class extends (env.WebSocket as unknown as new (url: string) => WebSocket) {
      constructor(url: string) {
        super(url);
        opened.push(url);
      }
    };
    const keys = await deriveRoomKeys(roomFor(7));
    env.wire.track(
      createTrackerTransport({
        trackers: accepted,
        discovery: keys.discovery,
        signal: keys.signal,
        WebSocket: WS,
        RTCPeerConnection: env.RTCPeerConnection,
        clock: env.wire.clock,
      }),
    );
    await env.wire.pump();
    expect(opened).toEqual(accepted);
  });

  it("with rooms, connect-src adds exactly the approved trackers, and never in an embed", () => {
    expect(sockets({ embed: false, collab: COLLAB_TRACKERS })).toEqual([
      "wss://tracker.openwebtorrent.com",
      "wss://tracker.webtorrent.dev",
    ]);
    expect(sockets({ embed: true, collab: COLLAB_TRACKERS })).toEqual([]);
  });

  it("without rooms, no tracker or socket at all", () => {
    for (const embed of [false, true]) {
      expect(sockets({ embed })).toEqual([]);
      for (const tracker of COLLAB_TRACKERS)
        expect(connect({ embed }).some((src) => tracker.includes(src.replace(/^https?:\/\//, "")))).toBe(false);
    }
  });

  it("never names STUN or TURN (not fetches: the build fixes them instead)", () => {
    for (const o of [
      { embed: false, collab: COLLAB_TRACKERS },
      { embed: true, collab: COLLAB_TRACKERS },
      { embed: false },
    ])
      expect(connect(o).filter((src) => /stun|turn/i.test(src))).toEqual([]);
  });

  it("livediagrams.dev (vercel.json, vite preview) sends the rooms policy to the app, not to embeds", () => {
    const sources = (url: string) => {
      const csp = securityHeadersFor(url)["Content-Security-Policy"];
      const connectSrc = csp.split("; ").find((d) => d.startsWith("connect-src ")) ?? "";
      return connectSrc.split(" ").filter((src) => /^wss?:/.test(src));
    };
    expect(sources("/")).toEqual(["wss://tracker.openwebtorrent.com", "wss://tracker.webtorrent.dev"]);
    expect(sources("/?embed=1")).toEqual([]);
    expect(sources("/?embed=1&host=1")).toEqual([]);
  });
});
