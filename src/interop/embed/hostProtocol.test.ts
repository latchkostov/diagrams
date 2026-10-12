import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPEEDS as LIVE_SPEEDS } from "../../live/controller";
import {
  diagramText,
  envelope,
  HOST_MESSAGE_TYPES,
  HostRateLimiter,
  hostOriginFromSearch,
  isFromHost,
  MAX_DIAGRAM_CHARS,
  MAX_HIGHLIGHT,
  parseHostMessage,
  parseOrigin,
  PROTOCOL,
  RATE,
  SPEEDS,
  TokenBucket,
} from "./hostProtocol";

const msg = (type: string, fields: Record<string, unknown> = {}) => ({ protocol: PROTOCOL, type, ...fields });

describe("host embed: the host's origin", () => {
  it("takes a plain http(s) origin from hostOrigin", () => {
    expect(hostOriginFromSearch("?embed=1&host=1&hostOrigin=https%3A%2F%2Fapp.example.com")).toEqual({
      ok: true,
      origin: "https://app.example.com",
    });
    expect(parseOrigin("http://localhost:5795")).toEqual({ ok: true, origin: "http://localhost:5795" });
    // A trailing slash is the same origin.
    expect(parseOrigin("https://app.example.com/")).toEqual({ ok: true, origin: "https://app.example.com" });
    expect(parseOrigin("https://app.example.com:8443")).toEqual({ ok: true, origin: "https://app.example.com:8443" });
  });

  it("refuses a missing value, wildcards, paths, credentials and other schemes", () => {
    expect(hostOriginFromSearch("?embed=1&host=1").ok).toBe(false);
    for (const bad of [
      "*",
      "null",
      "",
      "app.example.com",
      "https://app.example.com/page",
      "https://app.example.com/?q=1",
      "https://app.example.com/#x",
      "https://user:pw@app.example.com",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "ftp://app.example.com",
      // Not canonical: the browser reports "https://app.example.com", so nothing would ever match.
      "HTTPS://APP.EXAMPLE.COM",
      "https://app.example.com:443",
    ])
      expect(parseOrigin(bad).ok, bad).toBe(false);
  });

  it("reads only messages from the parent window, at the locked origin", () => {
    const parent = {};
    const self = {};
    const ctx = { parent, self, origin: "https://app.example.com" };
    expect(isFromHost({ source: parent, origin: "https://app.example.com" }, ctx)).toBe(true);
    // Another origin in the parent window (the page navigated, or the URL named someone else).
    expect(isFromHost({ source: parent, origin: "https://evil.example" }, ctx)).toBe(false);
    // The right origin from another window: a sibling frame, a pop-up, this frame itself.
    expect(isFromHost({ source: {}, origin: "https://app.example.com" }, ctx)).toBe(false);
    expect(isFromHost({ source: self, origin: "https://app.example.com" }, ctx)).toBe(false);
    expect(isFromHost({ source: null, origin: "https://app.example.com" }, ctx)).toBe(false);
    // Not framed: window.parent is the window itself.
    expect(isFromHost({ source: self, origin: "https://app.example.com" }, { ...ctx, parent: self })).toBe(false);
  });
});

describe("host embed: parsing messages", () => {
  it("ignores other protocols, non-objects and unknown types without a reply", () => {
    for (const data of [
      null,
      "load",
      42,
      [],
      { type: "load", diagram: {} },
      { protocol: "livediagrams.embed.v2", type: "play" },
      msg("selfDestruct"),
      msg("__proto__"),
      msg("toString"),
      { protocol: PROTOCOL },
    ])
      expect(parseHostMessage(data), JSON.stringify(data)).toEqual({ kind: "ignore" });
  });

  it("reads each message type, keeping only the documented fields", () => {
    expect(parseHostMessage(msg("play", { id: "1", extra: "dropped" }))).toEqual({
      kind: "ok",
      message: { type: "play", id: "1" },
    });
    expect(parseHostMessage(msg("pause"))).toEqual({ kind: "ok", message: { type: "pause" } });
    expect(parseHostMessage(msg("fit"))).toEqual({ kind: "ok", message: { type: "fit" } });
    expect(parseHostMessage(msg("setSpeed", { speed: 2 }))).toEqual({
      kind: "ok",
      message: { type: "setSpeed", speed: 2 },
    });
    expect(parseHostMessage(msg("selectSimulation", { simulation: null }))).toEqual({
      kind: "ok",
      message: { type: "selectSimulation", simulation: null },
    });
    expect(parseHostMessage(msg("setTheme", { theme: "dark" }))).toEqual({
      kind: "ok",
      message: { type: "setTheme", theme: "dark" },
    });
    expect(parseHostMessage(msg("highlight", { nodeIds: ["a", "b", "a"] }))).toEqual({
      kind: "ok",
      message: { type: "highlight", nodeIds: ["a", "b"] },
    });
    const diagram = { format: "diagrams/v1", nodes: [], edges: [] };
    expect(
      parseHostMessage(
        msg("load", {
          diagram,
          options: { theme: "light", simulation: "s1", autoplay: true, speed: 4, fit: false, unknown: 1 },
        }),
      ),
    ).toEqual({
      kind: "ok",
      message: {
        type: "load",
        diagram,
        options: { theme: "light", simulation: "s1", autoplay: true, speed: 4, fit: false },
      },
    });
    expect(parseHostMessage(msg("load", { diagram: "{}" }))).toMatchObject({ kind: "ok", message: { options: {} } });
  });

  it("refuses malformed fields of a known type, echoing a valid request id", () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [msg("setSpeed", { id: "r1", speed: 3 }), /speed must be one of 0.25, 0.5, 1, 2, 4, 8/],
      [msg("setSpeed", { speed: "2" }), /speed/],
      [msg("selectSimulation", { simulation: 7 }), /simulation/],
      [msg("selectSimulation", {}), /simulation/],
      [msg("selectSimulation", { simulation: "x".repeat(201) }), /simulation/],
      [msg("setTheme", { theme: "sepia" }), /theme/],
      [msg("highlight", { nodeIds: "a" }), /nodeIds/],
      [msg("highlight", { nodeIds: [1] }), /nodeIds/],
      [msg("highlight", { nodeIds: Array.from({ length: MAX_HIGHLIGHT + 1 }, (_, i) => `n${i}`) }), /nodeIds/],
      [msg("load", {}), /diagram is missing/],
      [msg("load", { diagram: 5 }), /diagram must be/],
      [msg("load", { diagram: [] }), /diagram must be/],
      [msg("load", { diagram: {}, options: "dark" }), /options must be an object/],
      [msg("load", { diagram: {}, options: { theme: "blue" } }), /options.theme/],
      [msg("load", { diagram: {}, options: { autoplay: "yes" } }), /options.autoplay/],
      [msg("load", { diagram: {}, options: { speed: 100 } }), /options.speed/],
      [msg("load", { diagram: {}, options: { simulation: 1 } }), /options.simulation/],
    ];
    for (const [data, error] of cases) {
      const parsed = parseHostMessage(data);
      expect(parsed.kind, JSON.stringify(data).slice(0, 80)).toBe("invalid");
      if (parsed.kind === "invalid") expect(parsed.message).toMatch(error);
    }
    expect(parseHostMessage(msg("setSpeed", { id: "r1", speed: 3 }))).toMatchObject({ kind: "invalid", id: "r1" });
    expect(parseHostMessage(msg("play", { id: 5 }))).toMatchObject({ kind: "invalid", message: /id must be/ });
    expect(parseHostMessage(msg("play", { id: "x".repeat(201) }))).toMatchObject({ kind: "invalid" });
  });

  it("knows every documented host message", () => {
    expect([...HOST_MESSAGE_TYPES].sort()).toEqual(
      ["fit", "highlight", "load", "pause", "play", "selectSimulation", "setSpeed", "setTheme"].sort(),
    );
  });

  it("offers exactly the live view's speeds", () => {
    expect([...SPEEDS]).toEqual([...LIVE_SPEEDS]);
  });

  it("wraps every outgoing message in the protocol", () => {
    expect(envelope({ type: "ready", version: 1 })).toEqual({ protocol: PROTOCOL, type: "ready", version: 1 });
  });
});

describe("host embed: size bounds", () => {
  it("measures a diagram before anything parses it", () => {
    expect(diagramText('{"a":1}')).toEqual({ ok: true, text: '{"a":1}' });
    expect(diagramText({ a: 1 })).toEqual({ ok: true, text: '{"a":1}' });
    expect(diagramText("x".repeat(MAX_DIAGRAM_CHARS + 1))).toEqual({ ok: false, tooLarge: true });
    expect(diagramText({ big: "x".repeat(MAX_DIAGRAM_CHARS) })).toEqual({ ok: false, tooLarge: true });
    // Too deep to stringify (a hostile structure): refused, not a crash.
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 200_000; i++) deep = { d: deep };
    expect(diagramText(deep)).toEqual({ ok: false, tooLarge: false });
    expect(diagramText(undefined)).toEqual({ ok: false, tooLarge: false });
  });
});

describe("host embed: rate limits", () => {
  it("a token bucket allows a burst, then refills over time", () => {
    const b = new TokenBucket(3, 1, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(500)).toBe(false);
    expect(b.take(1000)).toBe(true);
    // Never more than the capacity, however long it waited.
    expect([b.take(60_000), b.take(60_000), b.take(60_000), b.take(60_000)]).toEqual([true, true, true, false]);
  });

  it("limits all messages and, more strictly, loads; it says so at most once a second", () => {
    const r = new HostRateLimiter(0);
    const results = Array.from({ length: RATE.messages.capacity + 5 }, () => r.admit("play", 0));
    expect(results.filter((x) => x === "ok")).toHaveLength(RATE.messages.capacity);
    expect(results.filter((x) => x === "refuse")).toHaveLength(1);
    expect(results.filter((x) => x === "drop")).toHaveLength(4);

    const loads = new HostRateLimiter(0);
    const loaded = Array.from({ length: RATE.loads.capacity + 3 }, () => loads.admit("load", 0));
    expect(loaded.filter((x) => x === "ok")).toHaveLength(RATE.loads.capacity);
    // Other messages still go through while loads wait.
    expect(loads.admit("pause", 10)).toBe("ok");
    expect(loads.admit("load", 1100)).toBe("refuse");
    expect(loads.admit("load", 1000 + 1000 / RATE.loads.perSecond + 100)).toBe("ok");
  });
});

describe("host embed: replies go only to the host's origin", () => {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  it("no postMessage in the frame's code or the web component targets every origin", () => {
    const files = [
      "src/interop/embed/HostEmbedView.tsx",
      "src/interop/embed/hostLive.ts",
      "src/interop/embed/hostReducer.ts",
      "public/embed/live-diagram.js",
    ];
    let calls = 0;
    for (const f of files) {
      for (const m of read(f).matchAll(/postMessage\(([\s\S]*?)\)\s*;/g)) {
        calls++;
        expect(m[1], `${f}: ${m[0]}`).not.toMatch(/["'`]\*["'`]/);
      }
    }
    // The frame posts to origin.origin; the component to the viewer's origin.
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(read("src/interop/embed/HostEmbedView.tsx")).toContain(
      "window.parent.postMessage(envelope(m), origin.origin)",
    );
    expect(read("public/embed/live-diagram.js")).toContain("VIEWER.origin);");
  });
});
