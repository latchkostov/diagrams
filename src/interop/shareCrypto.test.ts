import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { base64UrlToBytes, bytesToBase64Url, bytesToText, textToBytes } from "./codec";
import {
  BadEncryptedLinkError,
  decodeEncryptedShare,
  decryptBytes,
  encodeEncryptedShare,
  encryptBytes,
  encryptedPayloadFromHash,
  encryptedPayloadFromInput,
  encryptedShareUrl,
  parseEncrypted,
  PBKDF2_ITERATIONS,
  WrongPasswordError,
} from "./shareCrypto";
import { passwordStrength } from "./passwordStrength";

// PBKDF2 at 600,000 iterations takes a noticeable fraction of a second per derivation, by design.
const SLOW = { timeout: 60_000 };

const DIAGRAM: DiagramFile = {
  format: "diagrams/v1",
  title: "Payments (internal)",
  nodes: [
    { id: "api", stencil: "generic.service", label: "Payments API", x: 0, y: 0 },
    { id: "db", stencil: "generic.database", label: "Ledger", x: 240, y: 0 },
  ],
  edges: [{ id: "e1", from: "api", to: "db", kind: "sync", label: "write" }],
} as DiagramFile;

const PASSWORD = "correct horse battery staple";

/**
 * A fixed vector, computed independently (Node's crypto.pbkdf2Sync for the key, WebCrypto AES-GCM):
 * salt 00..0f, IV a0..ab, additional data "livediagrams:e:v1", plaintext "livediagrams test vector".
 */
const VECTOR = {
  salt: Uint8Array.from({ length: 16 }, (_, i) => i),
  iv: Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i),
  plain: "livediagrams test vector",
  token: "v1.AAECAwQFBgcICQoLDA0ODw.oKGio6Slpqeoqaqr.xwfF5R9cpI9FS3_BJOFowIx-mVCaaObHdTDB6YKDb__0y5uajag3tA",
};

/** Flips one bit of the ciphertext part. */
function tamper(token: string, at = 3): string {
  const [v, salt, iv, ct] = token.split(".");
  const bytes = base64UrlToBytes(ct);
  bytes[at % bytes.length] ^= 0x01;
  return [v, salt, iv, bytesToBase64Url(bytes)].join(".");
}

describe("password links: crypto", () => {
  it("uses the OWASP-recommended PBKDF2-SHA-256 iteration count", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("matches the fixed test vector (fixed salt and IV)", SLOW, async () => {
    const token = await encryptBytes(textToBytes(VECTOR.plain), PASSWORD, { salt: VECTOR.salt, iv: VECTOR.iv });
    expect(token).toBe(VECTOR.token);
    expect(bytesToText(await decryptBytes(VECTOR.token, PASSWORD))).toBe(VECTOR.plain);
  });

  it("round-trips a diagram, with a fresh salt and IV every time", SLOW, async () => {
    const a = await encodeEncryptedShare(DIAGRAM, PASSWORD);
    const b = await encodeEncryptedShare(DIAGRAM, PASSWORD);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
    expect(a.split(".")[2]).not.toBe(b.split(".")[2]);
    expect(await decodeEncryptedShare(a, PASSWORD)).toEqual(DIAGRAM);
    // Nothing readable survives in the link.
    expect(a).not.toContain("Payments");
    expect(bytesToText(base64UrlToBytes(a.split(".")[3]))).not.toContain("Payments");
  });

  it("normalizes the password (NFC), so the same password typed on another system opens it", SLOW, async () => {
    const token = await encryptBytes(textToBytes("x"), "Café au lait 2026");
    expect(bytesToText(await decryptBytes(token, "Café au lait 2026"))).toBe("x");
  });

  it("rejects a wrong password with WrongPasswordError", SLOW, async () => {
    await expect(decryptBytes(VECTOR.token, "correct horse battery stapler")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    await expect(decodeEncryptedShare(VECTOR.token, "")).rejects.toThrow(/doesn't open this link/);
  });

  it("rejects tampered ciphertext, salt or IV (GCM authentication)", SLOW, async () => {
    await expect(decryptBytes(tamper(VECTOR.token), PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptBytes(tamper(VECTOR.token, 40), PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    const [v, salt, , ct] = VECTOR.token.split(".");
    const otherIv = bytesToBase64Url(Uint8Array.from({ length: 12 }, () => 7));
    await expect(decryptBytes([v, salt, otherIv, ct].join("."), PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    // A truncated link (a chat app cut it off) fails authentication too.
    await expect(decryptBytes(VECTOR.token.slice(0, -4), PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("checks the version before asking for a password", () => {
    const [, salt, iv, ct] = VECTOR.token.split(".");
    expect(() => parseEncrypted(["v2", salt, iv, ct].join("."))).toThrow(BadEncryptedLinkError);
    expect(() => parseEncrypted(["v2", salt, iv, ct].join("."))).toThrow(/newer version/);
    expect(() => parseEncrypted(["x1", salt, iv, ct].join("."))).toThrow(/damaged or incomplete/);
    expect(() => parseEncrypted([salt, iv, ct].join("."))).toThrow(BadEncryptedLinkError);
    expect(parseEncrypted(VECTOR.token).version).toBe("v1");
  });

  it("refuses malformed tokens without deriving a key", () => {
    const [v, salt, iv, ct] = VECTOR.token.split(".");
    for (const bad of [
      "",
      "v1",
      `${v}.${salt}.${iv}`,
      `${v}.${salt}.${iv}.${ct}.extra`,
      `${v}.${salt.slice(0, -2)}.${iv}.${ct}`, // salt too short
      `${v}.${salt}.${iv}AA.${ct}`, // IV too long
      `${v}.${salt}.${iv}.AAAA`, // shorter than a GCM tag
      `${v}.${salt}.${iv}.${ct}=`, // not base64url
      `${v}.${salt}.${iv}.A`, // impossible base64 length
    ])
      expect(() => parseEncrypted(bad), bad).toThrow(BadEncryptedLinkError);
  });

  it("binds the version (relabelling the token fails authentication, not just parsing)", SLOW, async () => {
    // The additional data is "livediagrams:e:v1": the same bytes encrypted without it don't open.
    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: VECTOR.salt, iterations: PBKDF2_ITERATIONS },
        await crypto.subtle.importKey("raw", textToBytes(PASSWORD), "PBKDF2", false, ["deriveBits"]),
        256,
      ),
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const noAad = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: VECTOR.iv }, key, textToBytes(VECTOR.plain)),
    );
    const token = ["v1", bytesToBase64Url(VECTOR.salt), bytesToBase64Url(VECTOR.iv), bytesToBase64Url(noAad)].join(".");
    await expect(decryptBytes(token, PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it("won't encrypt with a password shorter than 8 characters", async () => {
    await expect(encodeEncryptedShare(DIAGRAM, "short")).rejects.toThrow(/at least 8/);
  });
});

describe("password links: parsing", () => {
  it("reads the token from hashes, links and bare tokens", () => {
    const url = encryptedShareUrl(VECTOR.token, "https://www.livediagrams.dev/");
    expect(url).toBe(`https://www.livediagrams.dev/#e=${VECTOR.token}`);
    expect(encryptedPayloadFromHash(`#e=${VECTOR.token}`)).toBe(VECTOR.token);
    expect(encryptedPayloadFromHash(`#d=abc`)).toBeUndefined();
    expect(encryptedPayloadFromInput(url)).toBe(VECTOR.token);
    expect(encryptedPayloadFromInput(`e=${VECTOR.token}`)).toBe(VECTOR.token);
    expect(encryptedPayloadFromInput(`  ${VECTOR.token} `)).toBe(VECTOR.token);
    expect(encryptedPayloadFromInput("https://www.livediagrams.dev/#d=abc")).toBeUndefined();
    expect(encryptedPayloadFromInput("hello")).toBeUndefined();
  });
});

describe("password strength", () => {
  it("asks for 8 characters, flags guessable passwords and rewards long passphrases", () => {
    expect(passwordStrength("abc").level).toBe("short");
    expect(passwordStrength("1234567").level).toBe("short");
    for (const weak of ["password", "Password1!", "12345678", "aaaaaaaaaa", "Summer2026!", "qwertyuiop", "abcdefgh"])
      expect(passwordStrength(weak).level, weak).toBe("weak");
    expect(passwordStrength("aZ9$kq!x").level).toBe("fair");
    expect(passwordStrength("correct horse battery staple").level).toBe("strong");
    expect(passwordStrength("v7#Lq2!pZr@9wX4m").level).toBe("strong");
    expect(passwordStrength("abc").hint).toMatch(/at least 8/);
  });
});
