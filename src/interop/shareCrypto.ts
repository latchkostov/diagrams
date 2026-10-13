import type { DiagramFile } from "../model/types";
import { decryptBytes, encryptBytes } from "./passwordCrypto";
import { MIN_PASSWORD_LENGTH } from "./passwordLink";
import { compressDiagram, diagramFromCompressed } from "./share";

// Password links' encryption (the format and its parameters: ./passwordLink.ts; the WebCrypto work, shared with
// password-protected Interactive HTML files: ./passwordCrypto.ts). Loaded on use: by Copy link with password… and
// by the password prompt.

export * from "./passwordLink";
export { decryptBytes, encryptBytes } from "./passwordCrypto";

/** A diagram as a password link's token: compressed as a share link is, then encrypted. */
export async function encodeEncryptedShare(d: DiagramFile, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  return encryptBytes(await compressDiagram(d), password);
}

export async function decodeEncryptedShare(token: string, password: string): Promise<DiagramFile> {
  return diagramFromCompressed(await decryptBytes(token, password));
}
