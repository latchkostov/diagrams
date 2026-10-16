import { base64UrlToBytes, bytesToBase64Url } from "../interop/codec";

// Room links (collaboration C0): what an invitation carries, and how a page reads it without trusting it.
//
//   https://<app>/#room=v1.<epoch>.<secret>
//
// - The room secret is 32 random bytes, base64url without padding (exactly 43 characters). Every key the room
//   uses, and its public discovery id, is derived from it (./keys.ts); nothing else is needed to join.
// - <epoch> is the key epoch, a decimal integer (0 for a new room). A future rotation hands out a new secret
//   under a higher epoch; frames from any other epoch are refused before decryption (./envelope.ts).
// - It lives only in the fragment, which browsers never send to a server, nor in a Referer header (the Fetch
//   standard strips it; the app's Referrer-Policy is strict-origin-when-cross-origin on top). A link with the
//   secret in its query string is refused rather than opened, since that copy has already been sent to a server.
// - The parameter coexists with share links (`#d=`) and password links (`#e=`): a fragment carrying `room`
//   together with either is ambiguous and refused, as is a repeated `room`.
// - Parsing is strict: one canonical spelling per secret (a non-canonical base64url tail is refused), bounded
//   lengths, and error messages that never repeat the secret.

export const ROOM_PARAM = "room";
export const ROOM_LINK_VERSION = "v1";
export const ROOM_SECRET_BYTES = 32;
/** Epochs are u32 (the envelope header stores one). */
export const MAX_EPOCH = 0xffff_ffff;
/** Longer than any valid v1 value: a fragment value past this is refused unread. */
const MAX_VALUE_CHARS = 128;

export interface RoomLink {
  epoch: number;
  /** The room secret. Treat as a key: never log it, never put it anywhere but a fragment. */
  secret: Uint8Array;
}

export type RoomLinkProblem =
  | "missing" // no room parameter
  | "newer" // a version this build doesn't know
  | "damaged" // malformed, wrong length, non-canonical
  | "ambiguous" // repeated, or beside a share or password link
  | "in-query"; // the secret was put in the query string, so a server has seen it

const MESSAGES: Record<RoomLinkProblem, string> = {
  missing: "This isn't a room link.",
  newer: "This room link was made by a newer version of Live Diagrams. Reload the page to get the latest version.",
  damaged: "This room link is damaged or incomplete. Ask for the link again, and make sure it was copied in full.",
  ambiguous: "This link mixes a room with another kind of link, so it can't be opened safely.",
  "in-query":
    "This room link puts its key where servers can see it. Ask whoever sent it to start a new room and send a fresh link.",
};

export class RoomLinkError extends Error {
  readonly problem: RoomLinkProblem;
  constructor(problem: RoomLinkProblem) {
    super(MESSAGES[problem]);
    this.name = "RoomLinkError";
    this.problem = problem;
  }
}

const VALUE = /^v1\.(0|[1-9][0-9]{0,9})\.([A-Za-z0-9_-]{43})$/;

/** Splits a fragment (without '#') into raw key/value pairs. No percent-decoding: v1 values never need it. */
function fragmentPairs(fragment: string): [string, string][] {
  if (!fragment) return [];
  return fragment.split("&").map((part) => {
    const eq = part.indexOf("=");
    return eq === -1 ? [part, ""] : [part.slice(0, eq), part.slice(eq + 1)];
  });
}

/** Parses one `room` value (`v1.<epoch>.<secret>`). Throws RoomLinkError. */
export function parseRoomValue(value: string): RoomLink {
  if (value.length > MAX_VALUE_CHARS) throw new RoomLinkError("damaged");
  const version = /^(v\d+)\./.exec(value)?.[1];
  if (version && version !== ROOM_LINK_VERSION) throw new RoomLinkError("newer");
  const m = VALUE.exec(value);
  if (!m) throw new RoomLinkError("damaged");
  const epoch = Number(m[1]);
  if (!Number.isSafeInteger(epoch) || epoch > MAX_EPOCH) throw new RoomLinkError("damaged");
  let secret: Uint8Array;
  try {
    secret = base64UrlToBytes(m[2]);
  } catch {
    throw new RoomLinkError("damaged");
  }
  // 43 characters carry 258 bits; the last 2 must be zero, so every secret has exactly one spelling.
  if (secret.length !== ROOM_SECRET_BYTES || bytesToBase64Url(secret) !== m[2]) throw new RoomLinkError("damaged");
  return { epoch, secret };
}

/**
 * The room in a URL (or a bare `#…` fragment). Only the fragment is read; a `room` in the query string is refused
 * (see above). Throws RoomLinkError("missing") when there's no room at all.
 */
export function parseRoomLink(input: string): RoomLink {
  const s = input.trim();
  const hashAt = s.indexOf("#");
  const beforeHash = hashAt === -1 ? s : s.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt !== -1 && fragmentPairs(beforeHash.slice(queryAt + 1)).some(([k]) => k === ROOM_PARAM))
    throw new RoomLinkError("in-query");
  if (hashAt === -1) throw new RoomLinkError("missing");
  const pairs = fragmentPairs(s.slice(hashAt + 1));
  const rooms = pairs.filter(([k]) => k === ROOM_PARAM);
  if (!rooms.length) throw new RoomLinkError("missing");
  if (rooms.length > 1 || pairs.some(([k]) => k === "d" || k === "e")) throw new RoomLinkError("ambiguous");
  return parseRoomValue(rooms[0][1]);
}

/** Whether a fragment names a room at all (cheap; no validation). */
export const hasRoomFragment = (hash: string) =>
  fragmentPairs(hash.startsWith("#") ? hash.slice(1) : hash).some(([k]) => k === ROOM_PARAM);

/** The link for `room` on `base` (an app URL without query or fragment: appBaseUrl()). */
export function formatRoomLink(base: string, room: RoomLink): string {
  if (base.includes("#") || base.includes("?")) throw new Error("A room link's base must have no query or fragment.");
  if (room.secret.length !== ROOM_SECRET_BYTES) throw new Error("A room secret is 32 bytes.");
  if (!Number.isSafeInteger(room.epoch) || room.epoch < 0 || room.epoch > MAX_EPOCH)
    throw new Error("A room epoch is a u32.");
  return `${base}#${ROOM_PARAM}=${ROOM_LINK_VERSION}.${room.epoch}.${bytesToBase64Url(room.secret)}`;
}

interface LocationLike {
  hash: string;
  pathname: string;
  search: string;
}
interface HistoryLike {
  state: unknown;
  replaceState(data: unknown, unused: string, url: string): void;
}

/**
 * Reads the room from the address bar and removes the fragment at once (history replacement, no navigation), so
 * the secret doesn't stay in the address bar, a bookmark or a later copied URL. Copies made before (the
 * browser's history entry, a chat preview) are outside the page's reach: clearing is a mitigation, not erasure.
 */
export function consumeRoomFragment(
  loc: LocationLike = window.location,
  history: HistoryLike = window.history,
): RoomLink | undefined {
  const query = fragmentPairs(loc.search.replace(/^\?/, ""));
  const inQuery = query.some(([k]) => k === ROOM_PARAM);
  if (!inQuery && !hasRoomFragment(loc.hash)) return undefined;
  try {
    return parseRoomLink(`${loc.search}${loc.hash}`);
  } finally {
    // A secret in the query has reached a server already; still take it out of the address bar.
    const search = inQuery
      ? query
          .filter(([k]) => k !== ROOM_PARAM)
          .map(([k, v]) => `${k}=${v}`)
          .join("&")
      : loc.search.replace(/^\?/, "");
    history.replaceState(history.state, "", `${loc.pathname}${search ? `?${search}` : ""}`);
  }
}
