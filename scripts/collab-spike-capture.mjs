// Collaboration C0 spike: run BY HAND, never in CI or the test suites. It contacts public BitTorrent trackers and a
// public STUN server (the Lab spike's defaults), so it needs the owner's go-ahead each time it's run.
//
//   pnpm exec vite --port 6410 --strictPort --host 127.0.0.1     # in another terminal
//   node scripts/collab-spike-capture.mjs [--base http://127.0.0.1:6410/] [--timeout 90]
//
// Two isolated browser profiles open the Lab's spike panel; one creates a room with a synthetic canary title, the
// other joins with the room key in the fragment. Every WebSocket frame either page exchanges with a tracker is
// captured and checked: the room secret (base64url, hex), the canary and SDP plaintext (v=0, ice-ufrag,
// fingerprint, candidates) must never appear. The report (tests/.output/collab-spike/report.json) records what each
// tracker did see, whether the peers connected, and how long it took.

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const BASE = arg("base", "http://127.0.0.1:6410/");
const TIMEOUT = Number(arg("timeout", "90")) * 1000;
const CANARY = "Zephyrquill";
const LAB = `${BASE}?view=lab&preset=collab-c0`;

const browser = await chromium.launch();
const frames = [];
const appHost = new URL(BASE).host;

async function open(label) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("websocket", (ws) => {
    const host = new URL(ws.url()).host;
    if (host === appHost) return; // the dev server's hot reload
    const push = (direction) => (f) =>
      frames.push({
        page: label,
        tracker: ws.url(),
        direction,
        size: String(f.payload).length,
        payload: String(f.payload),
      });
    ws.on("framesent", push("sent"));
    ws.on("framereceived", push("received"));
  });
  return page;
}

const report = { started: new Date().toISOString(), base: BASE, connected: false, synced: false, editSynced: false };
try {
  const a = await open("creator");
  await a.goto(LAB);
  await a.getByTestId("collab-spike-new").click();
  const key = await a.getByTestId("collab-spike-key").inputValue();
  const secret = key.split(".")[2];
  const secretHex = Buffer.from(secret, "base64url").toString("hex");
  await a.getByTestId("collab-spike-connect").click();
  await a.getByTestId("collab-spike-title-input").fill(`${CANARY} payroll`);
  await a.getByTestId("collab-spike-set-title").click();

  const b = await open("guest");
  const t0 = Date.now();
  await b.goto(`${LAB}#room=${key}`);
  // The panel reads the key from the fragment (and clears it) once its code has loaded.
  await b.locator(`[data-testid="collab-spike-key"][value="${key}"]`).waitFor({ timeout: 30_000 });
  report.fragmentClearedFromAddressBar = !(await b.evaluate(() => globalThis.location.hash)).includes("room=");
  await b.getByTestId("collab-spike-connect").click();
  try {
    await b
      .getByTestId("collab-spike-peers")
      .filter({ hasText: /^[1-9]/ })
      .waitFor({ timeout: TIMEOUT });
    report.connected = true;
    report.connectSeconds = (Date.now() - t0) / 1000;
    await b.locator(`[data-testid="collab-spike-title"][data-title*="${CANARY}"]`).waitFor({ timeout: 20_000 });
    report.synced = true;
    await b.getByTestId("collab-spike-title-input").fill(`${CANARY} second edit`);
    await b.getByTestId("collab-spike-set-title").click();
    await a.locator(`[data-testid="collab-spike-title"][data-title*="second edit"]`).waitFor({ timeout: 20_000 });
    report.editSynced = true;
  } catch (err) {
    report.failure = String(err).split("\n")[0];
  }
  report.logs = {
    creator: await a
      .getByTestId("collab-spike-log")
      .innerText()
      .catch(() => ""),
    guest: await b
      .getByTestId("collab-spike-log")
      .innerText()
      .catch(() => ""),
  };

  const forbidden = {
    secretBase64url: secret,
    secretHex,
    canary: CANARY,
    sdpVersionLine: "v=0",
    iceUfrag: "ice-ufrag",
    fingerprint: "fingerprint:",
    candidate: "candidate:",
  };
  report.leaks = Object.fromEntries(
    Object.entries(forbidden).map(([what, needle]) => [what, frames.filter((f) => f.payload.includes(needle)).length]),
  );
  // What trackers did see, by field.
  const fields = {};
  for (const f of frames) {
    try {
      for (const k of Object.keys(JSON.parse(f.payload))) fields[k] = (fields[k] ?? 0) + 1;
    } catch {
      fields["(not JSON)"] = (fields["(not JSON)"] ?? 0) + 1;
    }
  }
  report.trackers = [...new Set(frames.map((f) => f.tracker))].map((url) => ({
    url,
    sent: frames.filter((f) => f.tracker === url && f.direction === "sent").length,
    received: frames.filter((f) => f.tracker === url && f.direction === "received").length,
  }));
  report.fieldsSeen = fields;
  report.frames = frames.length;
  report.sample = frames.slice(0, 3).map((f) => ({ ...f, payload: f.payload.slice(0, 400) }));
} finally {
  await browser.close();
}

mkdirSync("tests/.output/collab-spike", { recursive: true });
writeFileSync("tests/.output/collab-spike/report.json", JSON.stringify(report, null, 2));
const leaked = Object.values(report.leaks ?? {}).some((n) => n > 0);
console.log(JSON.stringify({ ...report, sample: undefined, logs: undefined }, null, 2));
console.log(
  leaked ? "LEAK: a forbidden value reached a tracker." : "No key, canary or SDP plaintext reached any tracker.",
);
process.exit(leaked ? 1 : 0);
