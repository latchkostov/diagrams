// Byte-level codecs shared by share links and draw.io: raw DEFLATE through the platform's
// CompressionStream (Chrome 103+, Firefox 113+, Safari 16.4+, Node 18+), and base64 / base64url.

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder("utf-8", { fatal: false });

export const textToBytes = (s: string) => utf8.encode(s);
export const bytesToText = (b: Uint8Array) => utf8Decode.decode(b);

export class TooLargeError extends Error {}

/** Pipes bytes through a (de)compressor, aborting once the output passes `maxBytes` (zip-bomb guard). */
async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  maxBytes = Infinity,
): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TooLargeError(
        `It expands to more than ${Math.round(maxBytes / 1_000_000)} MB, which is too large to open.`,
      );
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function compressionSupported(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (!compressionSupported())
    throw new Error(
      "This browser can't compress data (CompressionStream is missing). Try a current Chrome, Edge, Firefox or Safari.",
    );
  return pipe(bytes, new CompressionStream("deflate-raw"));
}

/** Inflates raw DEFLATE, refusing outputs larger than `maxBytes`. */
export async function inflateRaw(bytes: Uint8Array, maxBytes = Infinity): Promise<Uint8Array> {
  if (!compressionSupported())
    throw new Error(
      "This browser can't decompress data (DecompressionStream is missing). Try a current Chrome, Edge, Firefox or Safari.",
    );
  return pipe(bytes, new DecompressionStream("deflate-raw"), maxBytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** RFC 4648 §5 (URL- and filename-safe), unpadded. */
export const bytesToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function base64UrlToBytes(s: string): Uint8Array {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(std + "=".repeat((4 - (std.length % 4)) % 4));
}

export const textToBase64 = (s: string) => bytesToBase64(textToBytes(s));
