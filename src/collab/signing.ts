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

// ---------------------------------------------------------------- key agreement (knock-to-join, P5)
//
// Each member also has an X25519 key pair (its public half, `x`, named in the roster's join entry), so the host or a
// co-host can hand it an epoch's secret: ECDH with the member's key, HKDF over the shared bits (bound to the room, the
// epoch and both keys), then AES-GCM. And each epoch's start commits to its secret (a hash), so whoever hands one out,
// a member can check it's the epoch's own.

const AGREE = { name: "X25519" } as const;

export interface Agreement {
  /** The public key, base64url (43 characters). */
  x: string;
  privateKey: CryptoKey;
}

export interface StoredAgreement {
  x: string;
  jwk: JsonWebKey;
}

export async function newAgreement(): Promise<Agreement> {
  let pair: CryptoKeyPair;
  try {
    pair = (await subtle().generateKey(AGREE, true, ["deriveBits"])) as CryptoKeyPair;
  } catch {
    throw new SigningUnsupportedError();
  }
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return { x: bytesToBase64Url(raw), privateKey: pair.privateKey };
}

export async function storeAgreement(a: Agreement): Promise<StoredAgreement> {
  return { x: a.x, jwk: await subtle().exportKey("jwk", a.privateKey) };
}

export async function loadAgreement(stored: StoredAgreement): Promise<Agreement | undefined> {
  try {
    const privateKey = await subtle().importKey("jwk", stored.jwk, AGREE, true, ["deriveBits"]);
    // The halves must match: the JWK's public half is the stored one.
    if (stored.jwk.x !== stored.x || !publicKeyBytes(stored.x)) return undefined;
    return { x: stored.x, privateKey };
  } catch {
    return undefined;
  }
}

async function wrappingKey(mine: Agreement, theirs: string, info: Uint8Array): Promise<CryptoKey | undefined> {
  const bytes = publicKeyBytes(theirs);
  if (!bytes) return undefined;
  try {
    const pub = await subtle().importKey("raw", bytes as BufferSource, AGREE, true, []);
    const shared = await subtle().deriveBits({ name: "X25519", public: pub }, mine.privateKey, 256);
    const base = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    return await subtle().deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: textToBytes("livediagrams/wrap/v1") as BufferSource,
        info: info as BufferSource,
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    return undefined;
  }
}

/** `secret` for the holder of `theirs`, from `mine`: base64url (IV and ciphertext). `info` binds it to its use. */
export async function wrapSecret(
  mine: Agreement,
  theirs: string,
  info: Uint8Array,
  secret: Uint8Array,
): Promise<string> {
  const key = await wrappingKey(mine, theirs, info);
  if (!key) throw new Error("That key-agreement key isn't one.");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, secret as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return bytesToBase64Url(out);
}

/** A secret wrapped for `mine` by the holder of `theirs`; undefined when it wasn't (or was changed). Never throws. */
export async function unwrapSecret(
  mine: Agreement,
  theirs: string,
  info: Uint8Array,
  wrapped: string,
): Promise<Uint8Array | undefined> {
  try {
    const bytes = base64UrlToBytes(wrapped);
    if (bytes.length !== 12 + 32 + 16) return undefined;
    const key = await wrappingKey(mine, theirs, info);
    if (!key) return undefined;
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, 12) as BufferSource },
      key,
      bytes.subarray(12) as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    return undefined;
  }
}

/** A commitment to an epoch's secret (SHA-256 over it and its context), base64url: it names the secret, not reveals it. */
export async function commitSecret(secret: Uint8Array, ...context: (string | number)[]): Promise<string> {
  const digest = await subtle().digest(
    "SHA-256",
    signedBytes("livediagrams/epoch-secret/v1", ...context, secret) as BufferSource,
  );
  return bytesToBase64Url(new Uint8Array(digest));
}
