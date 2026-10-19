import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  ALERT_AFTER,
  classify,
  ensure,
  previous,
  streak,
  summary,
  timeFrom,
  trend,
  type SmokeResult,
} from "../../scripts/collab-smoke.mjs";

// The Nightly collaboration smoke's report (scripts/collab-smoke.mjs): its table, its trend and when it alerts.

const ok: SmokeResult = {
  ok: true,
  stage: "done",
  connectMs: 1500,
  pair: { local: "host", remote: "srflx", protocol: "udp" },
};
const fail = (cls: "tracker-unreachable" | "ice-nat" | "app-error"): SmokeResult => ({
  ok: false,
  stage: "connect",
  class: cls,
  message: "Timed out | waiting",
});

describe("collaboration smoke report", () => {
  it("says how a night went, and why it failed in plain words", () => {
    expect(summary(ok)).toContain("✅ passed");
    expect(summary(ok)).toContain("host/udp → srflx");
    expect(summary(fail("tracker-unreachable"))).toContain("Trackers unreachable (public network)");
    expect(summary(fail("ice-nat"))).toContain("ICE/NAT");
    expect(summary(fail("app-error"))).toContain("App error");
    // A pipe in a message can't break the table.
    expect(summary(fail("app-error"))).toContain(String.raw`Timed out \| waiting`);
  });

  it("connected transport without an initial document is an app error", () => {
    const night: SmokeResult = {
      ok: false,
      stage: "connect",
      trackers: { "tracker.webtorrent.dev": { opened: 1, framesReceived: 4 } },
      connectivity: { creator: "connected", joiner: "connected" },
      peerConnected: true,
      errors: [],
    };
    expect(classify(night)).toBe("app-error");
    expect(classify({ ...night, connectivity: {} })).toBe("app-error");
    expect(classify({ ...night, peerConnected: false, connectivity: { joiner: "connected" } })).toBe("app-error");
  });

  it("no tracker answered: trackers unreachable; answered but never connected: ICE/NAT; a page error: app", () => {
    const base: SmokeResult = { ok: false, stage: "connect", connectivity: {}, peerConnected: false, errors: [] };
    expect(classify({ ...base, trackers: { "tracker.webtorrent.dev": { opened: 1, framesReceived: 0 } } })).toBe(
      "tracker-unreachable",
    );
    expect(classify({ ...base, connectivity: { joiner: "trackers-unreachable" } })).toBe("tracker-unreachable");
    const answered = { "tracker.webtorrent.dev": { opened: 1, framesReceived: 3 } };
    expect(classify({ ...base, trackers: answered })).toBe("ice-nat");
    expect(classify({ ...base, trackers: answered, connectivity: { joiner: "ice-failed" } })).toBe("ice-nat");
    expect(classify({ ...base, trackers: answered, connectivity: { joiner: "no-answer" } })).toBe("ice-nat");
    expect(classify({ ...base, trackers: answered, errors: ["joiner: boom"] })).toBe("app-error");
    expect(classify({ ...base, trackers: answered, stage: "sync" })).toBe("app-error");
  });

  it("sync timing includes mutation-to-observation delay", async () => {
    const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
    // The edit takes 40 ms to send, the other side shows it 40 ms later: both count.
    const ms = await timeFrom(
      () => wait(40),
      () => wait(40),
    );
    expect(ms).toBeGreaterThanOrEqual(75);
  });

  it(`alerts only after ${ALERT_AFTER} failed nights in a row`, () => {
    expect(streak([fail("ice-nat"), fail("ice-nat"), ok, fail("ice-nat")])).toBe(2);
    expect(streak([fail("ice-nat"), fail("app-error"), fail("tracker-unreachable"), ok])).toBe(3);
    expect(trend([fail("ice-nat"), fail("ice-nat"), ok])).toContain("2 failed nights in a row");
    expect(trend([fail("ice-nat"), fail("ice-nat"), fail("ice-nat")])).toContain("3 failed nights in a row**");
  });

  it("reads earlier nights newest first, counting a night without a result as failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "collab-smoke-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    for (const [run, result] of [
      ["100", ok],
      ["300", fail("ice-nat")],
    ] as const) {
      mkdirSync(join(dir, run));
      writeFileSync(join(dir, run, "result.json"), JSON.stringify(result));
    }
    mkdirSync(join(dir, "200"));
    const nights = previous(dir);
    expect(nights.map((n) => n.ok)).toEqual([false, false, true]);
    expect(nights[1].stage).toBe("missing");
  });

  it("leaves a failed night's result when the smoke left none, and keeps the smoke's own", () => {
    const dir = mkdtempSync(join(tmpdir(), "collab-smoke-"));
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const missing = join(dir, "collab-smoke", "result.json");
    ensure(missing);
    expect(JSON.parse(readFileSync(missing, "utf8"))).toMatchObject({
      ok: false,
      stage: "missing",
      class: "app-error",
    });
    const own = join(dir, "result.json");
    writeFileSync(own, JSON.stringify(ok));
    ensure(own);
    expect(JSON.parse(readFileSync(own, "utf8"))).toEqual(ok);
  });
});
