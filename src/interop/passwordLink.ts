import { base64UrlToBytes } from "./codec";
import { LIMITS } from "./native";

// Password links: the share link's compressed diagram, encrypted in the browser with WebCrypto before it
// goes into the URL fragment, which browsers never send to a server. Nothing about it (the link, the
// password, the key) leaves the page.
//
//   #e=v1.<salt>.<iv>.<ciphertext>          each part base64url, unpadded
//
// v1: key = PBKDF2-HMAC-SHA-256(password (NFC), salt = 16 random bytes, 600,000 iterations) -> AES-256 key;
//     ciphertext = AES-GCM(key, iv = 12 random bytes, additional data = "livediagrams:e:v1",
//                          plaintext = raw-DEFLATE(minified diagram JSON)), with GCM's 128-bit tag appended.
// 600,000 is OWASP's Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA256 (checked October
// 2026). A future version can raise it: the version picks every parameter, so old links keep opening.
// The additional data binds the version, so a link can't be relabelled as another version.

// This module is the light part the app loads up front (recognising and checking a link); the WebCrypto
// work is in ./shareCrypto.ts, loaded when a password link is made or opened.

export const ENCRYPTED_PARAM = "e";
export const ENCRYPTION_VERSION = "v1";
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const MIN_PASSWORD_LENGTH = 8;

/** The password didn't open the link: GCM authentication failed (a wrong password, or a changed link). */
export class WrongPasswordError extends Error {
  constructor() {
    super("That password doesn't open this link. Check it and try again.");
    this.name = "WrongPasswordError";
  }
}

/** The link is malformed or made by a version of Diagrams this one doesn't know. Retrying won't help. */
export class BadEncryptedLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadEncryptedLinkError";
  }
}

export interface EncryptedParts {
  version: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

const DAMAGED =
  "This password-protected link is damaged or incomplete. Ask for the link again, and make sure it was copied in full.";

/** Splits and checks a `v1.<salt>.<iv>.<ciphertext>` token; throws BadEncryptedLinkError. */
export function parseEncrypted(token: string): EncryptedParts {
  const t = token.trim();
  if (t.length > LIMITS.maxTextChars) throw new BadEncryptedLinkError("This share link is too long to open.");
  const parts = t.split(".");
  const version = parts[0] ?? "";
  if (/^v\d+$/.test(version) && version !== ENCRYPTION_VERSION)
    throw new BadEncryptedLinkError(
      "This link was made by a newer version of Live Diagrams. Reload the page to update, then open the link again.",
    );
  if (version !== ENCRYPTION_VERSION || parts.length !== 4 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
    throw new BadEncryptedLinkError(DAMAGED);
  let decoded: Uint8Array[];
  try {
    decoded = parts.slice(1).map((p) => base64UrlToBytes(p));
  } catch {
    throw new BadEncryptedLinkError(DAMAGED);
  }
  const [salt, iv, ciphertext] = decoded;
  // GCM appends a 16-byte tag, so even an empty plaintext makes 16 bytes.
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < 17)
    throw new BadEncryptedLinkError(DAMAGED);
  return { version, salt, iv, ciphertext };
}

/** The `e` token from a hash like "#e=v1.…", or undefined. */
export function encryptedPayloadFromHash(hash: string): string | undefined {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h) return undefined;
  return new URLSearchParams(h).get(ENCRYPTED_PARAM) || undefined;
}

/** Accepts a full password link, an "#e=…" fragment, "e=…" or the bare `v1.…` token. */
export function encryptedPayloadFromInput(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const hashAt = s.indexOf("#");
  if (hashAt !== -1) return encryptedPayloadFromHash(s.slice(hashAt));
  if (/^e=/.test(s)) return encryptedPayloadFromHash(s);
  return /^v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s) ? s : undefined;
}

export function encryptedShareUrl(token: string, base: string): string {
  return `${base}#${ENCRYPTED_PARAM}=${token}`;
}
