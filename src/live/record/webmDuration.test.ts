import { describe, expect, it } from "vitest";
import { fixWebmDuration, webmDurationMs, withWebmDuration } from "./webmDuration";

const bytes = (...parts: (number[] | Uint8Array)[]) => new Uint8Array(parts.flatMap((p) => [...p]));
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** A WebM as MediaRecorder writes it: unknown-size Segment, Info without Duration, then a cluster. */
function liveWebm(opts: { info?: number[]; seekHead?: boolean; segmentSize?: number[] } = {}) {
  const info = opts.info ?? [
    ...[0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40], // TimecodeScale 1,000,000
    ...[0x4d, 0x80, 0x84, ...ascii("Chrm")], // MuxingApp
  ];
  const header = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77]; // EBML { DocType-ish filler }
  return bytes(
    header,
    [0x18, 0x53, 0x80, 0x67],
    opts.segmentSize ?? UNKNOWN,
    opts.seekHead ? [0x11, 0x4d, 0x9b, 0x74, 0x80] : [],
    [0x15, 0x49, 0xa9, 0x66, 0x80 | info.length],
    info,
    [0x16, 0x54, 0xae, 0x6b, 0x80], // Tracks (empty)
    [0x1f, 0x43, 0xb6, 0x75],
    UNKNOWN,
    [0xe7, 0x81, 0x00], // Timecode 0
  );
}

describe("WebM duration", () => {
  it("writes a Duration into a live recording's Info and keeps everything after it", () => {
    const original = liveWebm();
    expect(webmDurationMs(original)).toBeNull();
    const patched = withWebmDuration(original, 42_500)!;
    expect(patched).not.toBeNull();
    expect(webmDurationMs(patched)).toBeCloseTo(42_500, 6);
    // The cluster bytes are untouched at the end.
    expect([...patched.slice(-15)]).toEqual([...original.slice(-15)]);
  });

  it("honours the TimecodeScale", () => {
    const info = [0x2a, 0xd7, 0xb1, 0x82, 0x03, 0xe8]; // 1,000 ns per tick
    const patched = withWebmDuration(liveWebm({ info }), 1_000)!;
    expect(webmDurationMs(patched)).toBeCloseTo(1_000, 6);
    // Stored in ticks: 1 s = 1,000,000 ticks of 1 µs.
    const at = patched.findIndex((b, i) => b === 0x44 && patched[i + 1] === 0x89);
    expect(new DataView(patched.buffer, at + 3, 8).getFloat64(0)).toBe(1_000_000);
  });

  it("overwrites an existing Duration in place", () => {
    const info = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0];
    const original = liveWebm({ info });
    const patched = withWebmDuration(original, 3_000)!;
    expect(patched.length).toBe(original.length);
    expect(webmDurationMs(patched)).toBe(3_000);
  });

  it("grows a known Segment size to match", () => {
    const original = liveWebm({ segmentSize: [0x40, 0x40] }); // 64, in two bytes
    const patched = withWebmDuration(original, 1_000)!;
    const grown = patched.length - original.length;
    const at = 9 + 4; // after the EBML header and the Segment ID
    expect(((patched[at] & 0x3f) << 8) | patched[at + 1]).toBe(64 + grown);
  });

  it("leaves files it can't safely patch alone", () => {
    expect(withWebmDuration(liveWebm({ seekHead: true }), 1_000)).toBeNull();
    expect(withWebmDuration(new Uint8Array([1, 2, 3, 4]), 1_000)).toBeNull();
    expect(withWebmDuration(liveWebm().slice(0, 20), 1_000)).toBeNull();
    expect(withWebmDuration(liveWebm(), 0)).toBeNull();
    expect(withWebmDuration(liveWebm(), Number.NaN)).toBeNull();
  });

  it("patches a Blob, and passes other files through", async () => {
    const webm = new Blob([liveWebm()], { type: "video/webm;codecs=vp9" });
    const fixed = await fixWebmDuration(webm, 2_000);
    expect(fixed.type).toBe(webm.type);
    expect(webmDurationMs(new Uint8Array(await fixed.arrayBuffer()))).toBe(2_000);
    const mp4 = new Blob([new Uint8Array([0, 0, 0, 1])], { type: "video/mp4" });
    expect(await fixWebmDuration(mp4, 2_000)).toBe(mp4);
    const junk = new Blob([new Uint8Array([9, 9, 9])], { type: "video/webm" });
    expect(await fixWebmDuration(junk, 2_000)).toBe(junk);
  });
});
