import { t } from "../i18n";
import { BadTokenError, parseToken, type BadTokenReason, type EncryptedParts } from "./encryptedToken";

// Password links: the share link's compressed diagram, encrypted in the browser with WebCrypto before it
// goes into the URL fragment, which browsers never send to a server. Nothing about it (the link, the
// password, the key) leaves the page.
//
//   #e=v1.<salt>.<iv>.<ciphertext>          the token (./encryptedToken.ts: its format and parameters)
//
// The plaintext is raw-DEFLATE(minified diagram JSON). This module is the link's side only: the URL parameter,
// finding the token in a link, and the link's own words for what goes wrong. It's the light part the app loads up
// front (recognising and checking a link); the WebCrypto work is in ./passwordCrypto.ts, loaded when a password
// link is made or opened (./shareCrypto.ts). A password-protected Interactive HTML file (src/export/lock.ts)
// carries the same token, made with the same parameters, without this module.

export {
  ENCRYPTION_VERSION,
  IV_BYTES,
  MIN_PASSWORD_LENGTH,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  WrongPasswordError,
  type EncryptedParts,
} from "./encryptedToken";

export const ENCRYPTED_PARAM = "e";

/** What a link's prompt says when the password doesn't open it. */
// Crypto error text also used outside the editor; the dialog translates WrongPasswordError itself.
export const WRONG_LINK_PASSWORD = "That password doesn't open this link. Check it and try again.";

/** The link is malformed or made by a version of Diagrams this one doesn't know. Retrying won't help. */
export class BadEncryptedLinkError extends BadTokenError {
  constructor(reason: BadTokenReason, message: string) {
    super(reason, message);
    this.name = "BadEncryptedLinkError";
  }
}

const LINK_MESSAGES: Record<BadTokenReason, () => string> = {
  "too-long": () => t("passwordLink.tooLong"),
  newer: () => t("passwordLink.newer"),
  damaged: () => t("passwordLink.damaged"),
};

/** Splits and checks a link's `v1.<salt>.<iv>.<ciphertext>` token; throws BadEncryptedLinkError, in a link's words. */
export function parseEncrypted(token: string): EncryptedParts {
  try {
    return parseToken(token);
  } catch (err) {
    if (err instanceof BadTokenError) throw new BadEncryptedLinkError(err.reason, LINK_MESSAGES[err.reason]());
    throw err;
  }
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
