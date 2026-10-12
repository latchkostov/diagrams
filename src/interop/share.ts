import type { DiagramFile } from "../model/types";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToText,
  deflateRaw,
  inflateRaw,
  textToBytes,
  TooLargeError,
} from "./codec";
import { LIMITS, parseNative } from "./native";

// Share links carry the whole diagram in the URL *fragment* (#d=...), which browsers never send
// to the server: nothing is uploaded and nothing lands in server logs. Encoding: minified JSON ->
// raw DEFLATE -> base64url. Password links (#e=..., ./shareCrypto.ts) encrypt the same compressed bytes.

export const SHARE_PARAM = "d";
/** Links longer than this may be truncated by chat apps, email clients and some browsers. */
export const SHARE_WARN_LENGTH = 8000;

/** The diagram as minified JSON, raw-DEFLATE compressed: what a link carries, plain or encrypted. */
export function compressDiagram(d: DiagramFile): Promise<Uint8Array> {
  return deflateRaw(textToBytes(JSON.stringify(d)));
}

export async function encodeShare(d: DiagramFile): Promise<string> {
  return bytesToBase64Url(await compressDiagram(d));
}

const DAMAGED =
  "This share link is damaged or incomplete. Ask for the link again, and make sure it was copied in full.";

/** Inflates and validates what `compressDiagram` made (a plain payload, or a decrypted one). */
export async function diagramFromCompressed(bytes: Uint8Array): Promise<DiagramFile> {
  let json: string;
  try {
    json = bytesToText(await inflateRaw(bytes, LIMITS.maxTextChars));
  } catch (err) {
    if (err instanceof TooLargeError)
      throw new Error(`This share link's diagram is too large. ${err.message}`, { cause: err });
    throw new Error(DAMAGED, { cause: err });
  }
  // The same validator as every other way in (files, paste, Drive, storage).
  const result = parseNative(json);
  if (!result.ok) {
    if (/isn't valid JSON/.test(result.error)) throw new Error("This share link doesn't contain a readable diagram.");
    throw new Error(`This share link's diagram can't be opened: ${result.error}`);
  }
  return result.diagram;
}

export async function decodeShare(payload: string): Promise<DiagramFile> {
  if (payload.length > LIMITS.maxTextChars) throw new Error("This share link is too long to open.");
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(payload.trim());
  } catch (err) {
    throw new Error(DAMAGED, { cause: err });
  }
  return diagramFromCompressed(bytes);
}

/** The `d` payload from a hash like "#d=...", or undefined. */
export function sharePayloadFromHash(hash: string): string | undefined {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h) return undefined;
  const value = new URLSearchParams(h).get(SHARE_PARAM);
  return value || undefined;
}

/** Accepts a full share URL, a "#d=..." fragment, or the bare payload. */
export function sharePayloadFromInput(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const hashAt = s.indexOf("#");
  if (hashAt !== -1) return sharePayloadFromHash(s.slice(hashAt));
  if (/^d=/.test(s)) return sharePayloadFromHash(s);
  return /^[A-Za-z0-9_-]{16,}$/.test(s) ? s : undefined;
}

/**
 * Drops the address bar's fragment (a share payload) without navigating. A private diagram never keeps
 * one: the fragment is a copy of a diagram, and the address bar is synced, shared and kept in history.
 */
export function clearUrlFragment(): boolean {
  if (!window.location.hash) return false;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  return true;
}

/** The app's base URL (works under a sub-path such as /tools/diagrams/). */
export function appBaseUrl(loc: Pick<Location, "origin" | "pathname"> = window.location): string {
  return `${loc.origin}${loc.pathname}`;
}

export function shareUrl(payload: string, base = appBaseUrl()): string {
  return `${base}#${SHARE_PARAM}=${payload}`;
}

export interface EmbedOptions {
  /** Public example slug: embeds by name (short URL, follows updates). Otherwise the diagram is inlined. */
  example?: string;
  payload?: string;
  /** Live view: play a saved simulation (once the live view supports it). */
  live?: boolean;
  sim?: string;
}

export function embedUrl(o: EmbedOptions, base = appBaseUrl()): string {
  const p = new URLSearchParams({ embed: "1" });
  if (o.example) p.set("example", o.example);
  if (o.live) p.set("live", "1");
  if (o.live && o.sim) p.set("sim", o.sim);
  return `${base}?${p}${!o.example && o.payload ? `#${SHARE_PARAM}=${o.payload}` : ""}`;
}

export function embedSnippet(src: string, opts: { title: string; height: number }): string {
  const title = opts.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<iframe src="${src.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" title="${title}" width="100%" height="${Math.round(opts.height)}" style="border:0;border-radius:12px;max-width:100%" loading="lazy" allow="clipboard-write" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
