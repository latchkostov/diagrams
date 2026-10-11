// MediaRecorder writes WebM for live streaming: the Segment has an unknown size and its Info has no
// Duration. Players then show no length and can't seek (Chrome's own <video> included), which is
// poor for a clip dropped into Slack or a deck. This writes the Duration in, the way ffmpeg would,
// by rewriting only the Segment's Info element at the start of the file. Pure byte work, no DOM.
//
// Conservative by design: anything unexpected (a SeekHead or Cues whose offsets would move, an
// Info past the bytes we were given, malformed sizes) returns null and the file is used as it is.

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const SEEK_HEAD = 0x114d9b74;
const CUES = 0x1c53bb6b;
const CLUSTER = 0x1f43b675;

interface Vint {
  value: number;
  length: number;
  /** All value bits set: "unknown size". */
  unknown: boolean;
}

function readVint(bytes: Uint8Array, pos: number, keepMarker: boolean): Vint | null {
  const first = bytes[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let ones = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[pos + i];
    if (bytes[pos + i] !== 0xff) ones = false;
  }
  return { value, length, unknown: !keepMarker && ones };
}

interface Element {
  id: number;
  /** Start of the element (its ID). */
  start: number;
  /** Start of its data. */
  data: number;
  size: number;
  sizeLength: number;
  unknown: boolean;
}

function readElement(bytes: Uint8Array, pos: number): Element | null {
  const id = readVint(bytes, pos, true);
  if (!id || id.length > 4) return null;
  const size = readVint(bytes, pos + id.length, false);
  if (!size) return null;
  return {
    id: id.value,
    start: pos,
    data: pos + id.length + size.length,
    size: size.value,
    sizeLength: size.length,
    unknown: size.unknown,
  };
}

function readUint(bytes: Uint8Array, at: number, length: number): number {
  let v = 0;
  for (let i = 0; i < length; i++) v = v * 256 + bytes[at + i];
  return v;
}

/** An EBML size in exactly `length` bytes, or null if it doesn't fit. */
function encodeSize(value: number, length: number): Uint8Array | null {
  if (length < 1 || length > 8 || value >= 2 ** (7 * length) - 1) return null;
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (length - 1);
  return out;
}

function float64(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

/**
 * Returns `head` with the Segment Info's Duration set to `durationMs`, or null when the file isn't a
 * shape this can safely patch. `head` is the start of the file (it must contain the whole Info).
 */
export function withWebmDuration(head: Uint8Array, durationMs: number): Uint8Array<ArrayBuffer> | null {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) return null;
  const header = readElement(head, 0);
  if (!header || header.id !== EBML || header.unknown) return null;
  const segment = readElement(head, header.data + header.size);
  if (!segment || segment.id !== SEGMENT) return null;
  // Find Info among the Segment's first children (before any cluster).
  let pos = segment.data;
  let info: Element | null = null;
  while (pos < head.length) {
    const el = readElement(head, pos);
    if (!el || el.unknown) return null;
    // Their offsets point past Info, which is about to grow.
    if (el.id === SEEK_HEAD || el.id === CUES) return null;
    if (el.id === CLUSTER) break;
    if (el.id === INFO) {
      info = el;
      break;
    }
    pos = el.data + el.size;
  }
  if (!info || info.data + info.size > head.length) return null;

  let scale = 1_000_000;
  let existing: Element | null = null;
  for (let p = info.data; p < info.data + info.size;) {
    const el = readElement(head, p);
    if (!el || el.unknown || el.data + el.size > info.data + info.size) return null;
    if (el.id === TIMECODE_SCALE && el.size >= 1 && el.size <= 8) scale = readUint(head, el.data, el.size) || scale;
    if (el.id === DURATION) existing = el;
    p = el.data + el.size;
  }
  const duration = (durationMs * 1_000_000) / scale;

  // A Duration already there (often 0): overwrite it in place, nothing moves.
  if (existing) {
    const out = head.slice();
    const view = new DataView(out.buffer, out.byteOffset + existing.data, existing.size);
    if (existing.size === 8) view.setFloat64(0, duration);
    else if (existing.size === 4) view.setFloat32(0, duration);
    else return null;
    return out;
  }

  const added = new Uint8Array([0x44, 0x89, 0x88, ...float64(duration)]);
  const infoSize = encodeSize(info.size + added.length, 8);
  if (!infoSize) return null;
  const infoId = head.subarray(info.start, info.data - info.sizeLength);
  const growth = infoId.length + infoSize.length + info.size + added.length - (info.data + info.size - info.start);
  let segmentSize: Uint8Array | null = null;
  if (!segment.unknown) {
    segmentSize = encodeSize(segment.size + growth, segment.sizeLength);
    if (!segmentSize) return null;
  }
  const parts = [
    head.subarray(0, info.start),
    infoId,
    infoSize,
    head.subarray(info.data, info.data + info.size),
    added,
    head.subarray(info.data + info.size),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  if (segmentSize) out.set(segmentSize, segment.data - segment.sizeLength);
  return out;
}

/** Reads a WebM's Duration in ms (for tests and checks); null when there isn't one. */
export function webmDurationMs(head: Uint8Array): number | null {
  const header = readElement(head, 0);
  if (!header || header.id !== EBML) return null;
  const segment = readElement(head, header.data + header.size);
  if (!segment || segment.id !== SEGMENT) return null;
  for (let pos = segment.data; pos < head.length;) {
    const el = readElement(head, pos);
    if (!el || el.unknown || el.id === CLUSTER) return null;
    if (el.id === INFO) {
      let scale = 1_000_000;
      let duration: number | null = null;
      for (let p = el.data; p < el.data + el.size;) {
        const c = readElement(head, p);
        if (!c) return null;
        const view = new DataView(head.buffer, head.byteOffset + c.data, c.size);
        if (c.id === TIMECODE_SCALE) scale = readUint(head, c.data, c.size);
        if (c.id === DURATION) duration = c.size === 8 ? view.getFloat64(0) : view.getFloat32(0);
        p = c.data + c.size;
      }
      return duration === null ? null : (duration * scale) / 1_000_000;
    }
    pos = el.data + el.size;
  }
  return null;
}

/** How much of the file to read: Info comes right after the header, well inside the first chunk. */
const HEAD_BYTES = 256 * 1024;

/** The recording with its Duration written in, or the recording unchanged when it can't be patched. */
export async function fixWebmDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!/webm/i.test(blob.type)) return blob;
  try {
    const headLength = Math.min(blob.size, HEAD_BYTES);
    const head = new Uint8Array(await blob.slice(0, headLength).arrayBuffer());
    const patched = withWebmDuration(head, durationMs);
    return patched ? new Blob([patched, blob.slice(headLength)], { type: blob.type }) : blob;
  } catch {
    return blob;
  }
}
