/* global window, RTCPeerConnection */
// Same-run evidence for native host-candidate failures, independent of signaling, admission and the application.
// Both modes exchange a real data-channel message between isolated contexts. No servers or public network.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import console from "node:console";
import { chromiumLaunchArgs } from "../e2e-chromium.ts";

async function describe(page, remote) {
  return page.evaluate(async (remote) => {
    const state = window.nativeRtcProbe;
    const pc = state.pc;
    if (remote) await pc.setRemoteDescription(remote);
    else state.channel = pc.createDataChannel("native-diagnostic");
    await pc.setLocalDescription(remote ? await pc.createAnswer() : await pc.createOffer());
    if (pc.iceGatheringState !== "complete")
      await new Promise((resolve) => {
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") resolve();
        });
      });
    return pc.localDescription.toJSON();
  }, remote);
}

async function probe(args) {
  const browser = await chromium.launch({ args });
  try {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of pages)
      await page.evaluate(() => {
        const pc = new RTCPeerConnection({ iceServers: [] });
        const state = (window.nativeRtcProbe = { pc, events: [], candidates: [] });
        pc.addEventListener("icecandidate", (event) => {
          if (event.candidate) state.candidates.push(event.candidate.toJSON());
        });
        for (const event of [
          "iceconnectionstatechange",
          "connectionstatechange",
          "icegatheringstatechange",
          "signalingstatechange",
        ])
          pc.addEventListener(event, () => {
            state.events.push({
              event,
              ice: pc.iceConnectionState,
              connection: pc.connectionState,
              gathering: pc.iceGatheringState,
              signaling: pc.signalingState,
            });
          });
        pc.addEventListener("datachannel", (event) => {
          state.channel = event.channel;
          event.channel.addEventListener("message", (event) => (state.received = event.data));
        });
      });
    const offer = await describe(pages[0]);
    const answer = await describe(pages[1], offer);
    await pages[0].evaluate((answer) => window.nativeRtcProbe.pc.setRemoteDescription(answer), answer);
    let error;
    try {
      // A diagnostic observation window, matching the browser assertions' existing hang backstop.
      await pages[0].waitForFunction(() => window.nativeRtcProbe.channel?.readyState === "open", undefined, {
        timeout: 7_000,
      });
      await pages[0].evaluate(() => window.nativeRtcProbe.channel.send("native peer probe"));
      await pages[1].waitForFunction(() => window.nativeRtcProbe.received === "native peer probe", undefined, {
        timeout: 7_000,
      });
    } catch (failure) {
      error = failure.message;
    }
    const peers = await Promise.all(
      pages.map((page) =>
        page.evaluate(async () => {
          const state = window.nativeRtcProbe;
          const stats = await state.pc.getStats();
          return {
            connection: state.pc.connectionState,
            ice: state.pc.iceConnectionState,
            channel: state.channel?.readyState,
            received: state.received,
            candidates: state.candidates,
            events: state.events,
            stats: [...stats.values()].filter((stat) =>
              ["local-candidate", "remote-candidate", "candidate-pair"].includes(stat.type),
            ),
          };
        }),
      ),
    );
    return { args, delivered: peers[1].received === "native peer probe", error, peers };
  } finally {
    await browser.close();
  }
}

const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/ci/native-rtc.mjs <output.json>");
const report = { platform: process.platform, modes: {} };
mkdirSync(dirname(output), { recursive: true });
for (const [mode, directHostCandidates] of [
  ["mdns", false],
  ["direct", true],
]) {
  report.modes[mode] = await probe(chromiumLaunchArgs("127.0.0.1", process.platform, { directHostCandidates }));
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Native RTC ${mode}: delivered=${report.modes[mode].delivered}`);
}
