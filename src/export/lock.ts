import { bytesToText, deflateRaw, inflateRaw, textToBytes } from "../interop/codec";
import { decryptBytes, encryptBytes } from "../interop/passwordCrypto";
import { BadTokenError, MIN_PASSWORD_LENGTH, WrongPasswordError } from "../interop/encryptedToken";
import { LIMITS } from "../interop/native";
import { htmlFileName, LOCKED_TITLE, PAYLOAD_VERSION, type ExportPayload, type LockedPayload } from "./inject";

// Password-protected Interactive HTML (Require a password, in the export dialog; `--password` in the agent skill's
// export-html.mjs). The whole payload (the diagram with its title, labels, notes, simulations and properties, the
// icons it uses, the banner, the options and the export date) is encrypted with password links' own crypto
// (src/interop/passwordCrypto.ts: PBKDF2-HMAC-SHA-256 at 600,000 iterations, AES-256-GCM, the v1 token of
// src/interop/encryptedToken.ts), compressed first as a link's diagram is. The file then carries that token and the
// theme, nothing else (src/export/inject.ts, injectLocked). The viewer asks for the password and decrypts in the
// page: no request, no storage, and the password is never kept.
//
// Async (WebCrypto, CompressionStream), so it lives apart from inject.ts, which stays pure. Runs in the app (the
// export), the viewer (unlocking) and Node 20+ (the skill, through scripts/lib/app.mjs).

export { MIN_PASSWORD_LENGTH } from "../interop/encryptedToken";

/** What the viewer says when a password doesn't open the file. */
export const WRONG_FILE_PASSWORD = "That password doesn't open this file. Check it and try again.";
const DAMAGED = "This file's diagram is damaged. Export it again from Live Diagrams.";
/** Where the browser has no WebCrypto (a page on plain http://, or an old browser). */
export const CANT_UNLOCK_HERE =
  "This browser can't unlock the file here: it decrypts only on https:// pages and files opened from disk. Download the file and open it from disk, or use a current browser.";

/** Why a file didn't open: `wrong` is a wrong password (try again); otherwise retrying won't help. */
export class UnlockError extends Error {
  readonly wrong: boolean;
  constructor(message: string, wrong = false) {
    super(message);
    this.name = "UnlockError";
    this.wrong = wrong;
  }
}

/** Letters and digits that can't be mistaken for each other (no 0/o, 1/l/i). */
const SUFFIX_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/**
 * A protected file's name: LOCKED_TITLE and a short random suffix ("Diagram (password protected) k7m2q.html"), so two
 * exports never share a name, yet nothing in it comes from the diagram (or says when it was made). `bytes`: tests.
 */
export function lockedFileName(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(5))): string {
  const suffix = [...bytes].map((b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join("");
  return htmlFileName(`${LOCKED_TITLE} ${suffix}`);
}

/** The payload encrypted with `password`, as a password-protected file's data block holds it. */
export async function lockPayload(payload: ExportPayload, password: string): Promise<LockedPayload> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  const encrypted = await encryptBytes(await deflateRaw(textToBytes(JSON.stringify(payload))), password);
  // The viewer refuses a longer token (parseEncrypted), so never write one.
  if (encrypted.length > LIMITS.maxTextChars) throw new Error("This diagram is too large to protect with a password.");
  return { version: PAYLOAD_VERSION, encrypted, theme: payload.options.theme };
}

/**
 * The payload's JSON text from a locked file's token, refusing more than `maxBytes` once inflated. Throws an
 * UnlockError in the file's words: `wrong` for a wrong password, otherwise damaged or can't decrypt here.
 */
export async function unlockPayloadText(token: string, password: string, maxBytes: number): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await decryptBytes(token, password);
  } catch (err) {
    if (err instanceof WrongPasswordError) throw new UnlockError(WRONG_FILE_PASSWORD, true);
    if (err instanceof BadTokenError) throw new UnlockError(DAMAGED);
    throw new UnlockError(globalThis.crypto?.subtle ? DAMAGED : CANT_UNLOCK_HERE);
  }
  try {
    return bytesToText(await inflateRaw(bytes, maxBytes));
  } catch {
    throw new UnlockError(DAMAGED);
  }
}
