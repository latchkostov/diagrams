import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMON_HEADERS, cspDirectives } from "../../scripts/security-headers";
import { formatRoomLink } from "./link";
import { seededBytes } from "./random";
import { COLLAB_STUN, COLLAB_TRACKERS } from "./transport/tracker";

// What keeps a room's key out of other people's logs, and the spike's public services out of production.

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

describe("production can't reach the spike's public services", () => {
  it("allows no tracker, socket or STUN endpoint in connect-src", () => {
    for (const embed of [false, true]) {
      const connect = cspDirectives({ embed }).find(([name]) => name === "connect-src")![1];
      expect(connect.filter((src) => /^wss?:/.test(src) || src === "*")).toEqual([]);
      for (const tracker of [...COLLAB_TRACKERS, ...COLLAB_STUN.map((s) => String(s.urls))])
        expect(connect.some((src) => tracker.includes(src.replace(/^https?:\/\//, "")))).toBe(false);
    }
  });
});
