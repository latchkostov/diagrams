import type { DiagramFile } from "../model/types";
import { decryptBytes, encryptBytes } from "./passwordCrypto";
import { MIN_PASSWORD_LENGTH, parseEncrypted, WRONG_LINK_PASSWORD, WrongPasswordError } from "./passwordLink";
import { compressDiagram, diagramFromCompressed } from "./share";

// Password links' encryption (the format and its parameters: ./passwordLink.ts; the WebCrypto work, shared with
// password-protected Interactive HTML files: ./passwordCrypto.ts). Loaded on use: by Link with password… and
// by the password prompt.

export * from "./passwordLink";
export { decryptBytes, encryptBytes } from "./passwordCrypto";

declare global {
  interface Window {
    __passwordWork?: { pending: number };
  }
}
// Includes compression/decompression, so cancellation tests observe the entire late result.
const passwordWork = { pending: 0 };
if (import.meta.env.VITE_E2E === "1") window.__passwordWork = passwordWork;

/** A diagram as a password link's token: compressed as a share link is, then encrypted. */
export async function encodeEncryptedShare(d: DiagramFile, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (import.meta.env.VITE_E2E === "1") passwordWork.pending++;
  try {
    return await encryptBytes(await compressDiagram(d), password);
  } finally {
    if (import.meta.env.VITE_E2E === "1") passwordWork.pending--;
  }
}

/** Opens a password link's token. Throws BadEncryptedLinkError or WrongPasswordError, in a link's words. */
export async function decodeEncryptedShare(token: string, password: string): Promise<DiagramFile> {
  if (import.meta.env.VITE_E2E === "1") passwordWork.pending++;
  try {
    parseEncrypted(token);
    let bytes: Uint8Array;
    try {
      bytes = await decryptBytes(token, password);
    } catch (err) {
      if (err instanceof WrongPasswordError) throw new WrongPasswordError(WRONG_LINK_PASSWORD);
      throw err;
    }
    return await diagramFromCompressed(bytes);
  } finally {
    if (import.meta.env.VITE_E2E === "1") passwordWork.pending--;
  }
}
