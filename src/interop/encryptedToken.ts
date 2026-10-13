import { base64UrlToBytes } from "./codec";
import { LIMITS } from "./native";

// The password-encrypted token: its format, its parameters and its errors, and nothing about where it travels.
// Password links put it in a URL (./passwordLink.ts); a password-protected Interactive HTML file puts it in its data
// block (src/export/lock.ts). The WebCrypto work that makes and opens it is ./passwordCrypto.ts.
//
//   v1.<salt>.<iv>.<ciphertext>          each part base64url, unpadded
//
// v1: key = PBKDF2-HMAC-SHA-256(password (NFC), salt = 16 random bytes, 600,000 iterations) -> AES-256 key;
//     ciphertext = AES-GCM(key, iv = 12 random bytes, additional data = "livediagrams:e:v1", plaintext), with GCM's
//     128-bit tag appended. The plaintext is the carrier's (a link's compressed diagram, a file's compressed payload).
// 600,000 is OWASP's Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA256 (checked October 2026). A
// future version can raise it: the version picks every parameter, so old tokens keep opening. The additional data
// binds the version, so a token can't be relabelled as another version. ("e" in it is the link parameter v1 was
// first made for; it's part of v1's fixed bytes now, whatever carries the token.)

export const ENCRYPTION_VERSION = "v1";
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const MIN_PASSWORD_LENGTH = 8;
/** v1's additional data (see above). */
export const TOKEN_ADDITIONAL_DATA = `livediagrams:e:${ENCRYPTION_VERSION}`;

/**
 * The password didn't open the token: GCM authentication failed (a wrong password, or a changed token). Its carrier
 * may say so in its own words (a link, a file); the class is the same, so `instanceof` works everywhere.
 */
export class WrongPasswordError extends Error {
  constructor(message = "That password doesn't open it. Check it and try again.") {
    super(message);
    this.name = "WrongPasswordError";
  }
}

/** Why a token can't be read at all (retrying won't help): too long, from a newer version, or damaged. */
export type BadTokenReason = "too-long" | "newer" | "damaged";

/** The token is malformed, too long or from a newer version. Its carrier words the message. */
export class BadTokenError extends Error {
  readonly reason: BadTokenReason;
  constructor(reason: BadTokenReason, message = `This encrypted diagram can't be read (${reason}).`) {
    super(message);
    this.name = "BadTokenError";
    this.reason = reason;
  }
}

export interface EncryptedParts {
  version: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

/** Splits and checks a `v1.<salt>.<iv>.<ciphertext>` token; throws BadTokenError. */
export function parseToken(token: string): EncryptedParts {
  const t = token.trim();
  if (t.length > LIMITS.maxTextChars) throw new BadTokenError("too-long");
  const parts = t.split(".");
  const version = parts[0] ?? "";
  if (/^v\d+$/.test(version) && version !== ENCRYPTION_VERSION) throw new BadTokenError("newer");
  if (version !== ENCRYPTION_VERSION || parts.length !== 4 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
    throw new BadTokenError("damaged");
  let decoded: Uint8Array[];
  try {
    decoded = parts.slice(1).map((p) => base64UrlToBytes(p));
  } catch {
    throw new BadTokenError("damaged");
  }
  const [salt, iv, ciphertext] = decoded;
  // GCM appends a 16-byte tag, so even an empty plaintext makes 16 bytes.
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < 17)
    throw new BadTokenError("damaged");
  return { version, salt, iv, ciphertext };
}
