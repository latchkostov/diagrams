import { base64UrlToBytes, bytesToBase64Url, textToBytes } from "../interop/codec";

// Signatures for signed rooms (meeting hosts design §2, P4): Ed25519 in WebCrypto, nothing of our own. A member's
// identity is an Ed25519 key pair this tab keeps (its private half in the tab's sessionStorage record, the same class
// of secret as the room link); its public half (32 bytes, base64url: 43 characters) names the member in the room's
// signed roster (./roster.ts) and verifies what it signs: its document updates and Live frames (./session.ts), and
// the binding of its session's sender id and Yjs client id to it (presence).
//
// The algorithm is the crypto review's to confirm (owner decision 14); everything goes through this module.

export const SIGNATURE_BYTES = 64;
export const PUBLIC_KEY_BYTES = 32;
const ALGORITHM = { name: "Ed25519" } as const;

export interface Identity {
  /** The public key, base64url (43 characters): this member's name in the roster. */
  key: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

/** What a tab keeps of its identity (its tab record): the private key as a JWK, and the public key. */
export interface StoredIdentity {
  key: string;
  jwk: JsonWebKey;
}

const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error("This browser can't sign (WebCrypto is missing).");
  return globalThis.crypto.subtle;
};

/** This browser can't sign (no Ed25519 in its WebCrypto): it can't join a signed room. */
export class SigningUnsupportedError extends Error {
  constructor() {
    super("This browser can't check signatures (Ed25519), so it can't join this room.");
    this.name = "SigningUnsupportedError";
  }
}

/** A new identity: an Ed25519 key pair, its private half exportable only to be kept in this tab's record. */
export async function newIdentity(): Promise<Identity> {
  let pair: CryptoKeyPair;
  try {
    pair = (await subtle().generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  } catch {
    throw new SigningUnsupportedError();
  }
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return { key: bytesToBase64Url(raw), publicKey: pair.publicKey, privateKey: pair.privateKey };
}

export async function storeIdentity(identity: Identity): Promise<StoredIdentity> {
  return { key: identity.key, jwk: await subtle().exportKey("jwk", identity.privateKey) };
}

/** An identity back from its record; undefined when the record doesn't hold one (or its halves don't match). */
export async function loadIdentity(stored: StoredIdentity): Promise<Identity | undefined> {
  try {
    const privateKey = await subtle().importKey("jwk", stored.jwk, ALGORITHM, true, ["sign"]);
    const publicKey = await importPublic(stored.key);
    if (!publicKey) return undefined;
    // The pair must match: a signature by the one verifies under the other.
    const probe = textToBytes("livediagrams/identity-check");
    if (
      !(await subtle().verify(
        ALGORITHM,
        publicKey,
        (await sign(privateKey, probe)) as BufferSource,
        probe as BufferSource,
      ))
    )
      return undefined;
    return { key: stored.key, publicKey, privateKey };
  } catch {
    return undefined;
  }
}

/** A well-formed public key's bytes (32), or undefined. */
export function publicKeyBytes(key: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return undefined;
  try {
    const bytes = base64UrlToBytes(key);
    return bytes.length === PUBLIC_KEY_BYTES && bytesToBase64Url(bytes) === key ? bytes : undefined;
  } catch {
    return undefined;
  }
}

const imported = new Map<string, Promise<CryptoKey | undefined>>();

/** A member's public key, imported once (bounded: a room has few members). */
export function importPublic(key: string): Promise<CryptoKey | undefined> {
  let pending = imported.get(key);
  if (!pending) {
    const bytes = publicKeyBytes(key);
    pending = bytes
      ? subtle()
          .importKey("raw", bytes as BufferSource, ALGORITHM, true, ["verify"])
          .catch(() => undefined)
      : Promise.resolve(undefined);
    if (imported.size >= 256) imported.clear();
    imported.set(key, pending);
  }
  return pending;
}

export async function sign(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().sign(ALGORITHM, privateKey, data as BufferSource));
}

/** Whether `signature` is `key`'s over `data`. Never throws. */
export async function verify(key: string, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  if (signature.length !== SIGNATURE_BYTES) return false;
  const publicKey = await importPublic(key);
  if (!publicKey) return false;
  try {
    return await subtle().verify(ALGORITHM, publicKey, signature as BufferSource, data as BufferSource);
  } catch {
    return false;
  }
}

/** Domain-separated bytes to sign: a label, then each part with its length, so no two inputs share a spelling. */
export function signedBytes(label: string, ...parts: (Uint8Array | string | number)[]): Uint8Array {
  const chunks = [label, ...parts].map((p) =>
    typeof p === "string" ? textToBytes(p) : typeof p === "number" ? textToBytes(String(p)) : p,
  );
  const out = new Uint8Array(chunks.reduce((n, c) => n + 4 + c.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const c of chunks) {
    view.setUint32(at, c.length);
    out.set(c, at + 4);
    at += 4 + c.length;
  }
  return out;
}
