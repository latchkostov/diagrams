import { describe, expect, it } from "vitest";
import { textToBytes } from "../interop/codec";
import { loadIdentity, newIdentity, publicKeyBytes, sign, signedBytes, storeIdentity, verify } from "./signing";

describe("signing (Ed25519 in WebCrypto)", () => {
  it("signs and verifies; another key, other data or a changed signature don't verify", async () => {
    const a = await newIdentity();
    const b = await newIdentity();
    const data = textToBytes("livediagrams");
    const sig = await sign(a.privateKey, data);
    expect(sig.length).toBe(64);
    expect(await verify(a.key, sig, data)).toBe(true);
    expect(await verify(b.key, sig, data)).toBe(false);
    expect(await verify(a.key, sig, textToBytes("livediagramz"))).toBe(false);
    const bent = sig.slice();
    bent[0] ^= 1;
    expect(await verify(a.key, bent, data)).toBe(false);
    expect(await verify(a.key, sig.subarray(1), data)).toBe(false);
    expect(await verify("not a key", sig, data)).toBe(false);
  });

  it("an identity survives its record (a reload); one whose halves don't match doesn't", async () => {
    const a = await newIdentity();
    const stored = await storeIdentity(a);
    const back = await loadIdentity(JSON.parse(JSON.stringify(stored)));
    expect(back?.key).toBe(a.key);
    const data = textToBytes("again");
    expect(await verify(a.key, await sign(back!.privateKey, data), data)).toBe(true);
    const other = await newIdentity();
    expect(await loadIdentity({ key: other.key, jwk: stored.jwk })).toBeUndefined();
    expect(await loadIdentity({ key: a.key, jwk: { kty: "OKP" } })).toBeUndefined();
  });

  it("names a key only in its one canonical spelling", async () => {
    const a = await newIdentity();
    expect(publicKeyBytes(a.key)?.length).toBe(32);
    expect(publicKeyBytes(a.key.slice(1))).toBeUndefined();
    expect(publicKeyBytes(`${a.key}=`)).toBeUndefined();
  });

  it("separates what it signs: no two different inputs share bytes", () => {
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    expect(hex(signedBytes("l", "ab", "c"))).not.toBe(hex(signedBytes("l", "a", "bc")));
    expect(hex(signedBytes("l", "abc"))).not.toBe(hex(signedBytes("la", "bc")));
    expect(hex(signedBytes("l", 12))).toBe(hex(signedBytes("l", "12")));
  });
});
