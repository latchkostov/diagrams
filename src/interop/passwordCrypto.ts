import { bytesToBase64Url, textToBytes } from "./codec";
import {
  ENCRYPTED_PARAM,
  ENCRYPTION_VERSION,
  IV_BYTES,
  parseEncrypted,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  WrongPasswordError,
} from "./passwordLink";

// The password encryption itself (the format and its parameters: ./passwordLink.ts): WebCrypto's PBKDF2 and
// AES-GCM, nothing else. Shared by password links (./shareCrypto.ts) and password-protected Interactive HTML files
// (src/export/lock.ts), so both use exactly the same parameters. It knows nothing about links or files: it turns
// bytes and a password into a `v1.…` token and back. Loaded on use.

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

/** Decrypts a `v1.…` token. Throws BadEncryptedLinkError (bad token) or WrongPasswordError (GCM said no). */
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
