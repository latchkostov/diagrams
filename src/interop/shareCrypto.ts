import type { DiagramFile } from "../model/types";
import { bytesToBase64Url, textToBytes } from "./codec";
import {
  ENCRYPTED_PARAM,
  ENCRYPTION_VERSION,
  IV_BYTES,
  MIN_PASSWORD_LENGTH,
  parseEncrypted,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  WrongPasswordError,
} from "./passwordLink";
import { compressDiagram, diagramFromCompressed } from "./share";

// Password links' encryption (the format and its parameters: ./passwordLink.ts). Loaded on use: by
// Copy link with password… and by the password prompt.

export * from "./passwordLink";

const AAD = textToBytes(`livediagrams:${ENCRYPTED_PARAM}:${ENCRYPTION_VERSION}`);

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s)
    throw new Error(
      "This browser can't encrypt or decrypt here (WebCrypto needs a secure https:// page). Try a current browser.",
    );
  return s;
};

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const material = await subtle().importKey(
    "raw",
    textToBytes(password.normalize("NFC")) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

/** Encrypts bytes with a password into a `v1.…` token. `salt` and `iv` are for test vectors only. */
export async function encryptBytes(
  plain: Uint8Array,
  password: string,
  fixed: { salt?: Uint8Array; iv?: Uint8Array } = {},
): Promise<string> {
  const salt = fixed.salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = fixed.iv ?? crypto.getRandomValues(new Uint8Array(IV_BYTES));
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new Error("Wrong salt or IV length.");
  const key = await deriveKey(password, salt, "encrypt");
  const sealed = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD as BufferSource, tagLength: 128 },
    key,
    plain as BufferSource,
  );
  return [
    ENCRYPTION_VERSION,
    bytesToBase64Url(salt),
    bytesToBase64Url(iv),
    bytesToBase64Url(new Uint8Array(sealed)),
  ].join(".");
}

/** Decrypts a `v1.…` token. Throws BadEncryptedLinkError (bad link) or WrongPasswordError (GCM said no). */
export async function decryptBytes(token: string, password: string): Promise<Uint8Array> {
  const { salt, iv, ciphertext } = parseEncrypted(token);
  const key = await deriveKey(password, salt, "decrypt");
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: AAD as BufferSource, tagLength: 128 },
        key,
        ciphertext as BufferSource,
      ),
    );
  } catch {
    throw new WrongPasswordError();
  }
}

/** A diagram as a password link's token: compressed as a share link is, then encrypted. */
export async function encodeEncryptedShare(d: DiagramFile, password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  return encryptBytes(await compressDiagram(d), password);
}

export async function decodeEncryptedShare(token: string, password: string): Promise<DiagramFile> {
  return diagramFromCompressed(await decryptBytes(token, password));
}
