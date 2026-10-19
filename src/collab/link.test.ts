import { describe, expect, it } from "vitest";
import { bytesToBase64Url } from "../interop/codec";
import { consumeRoomFragment, formatRoomLink, parseRoomLink, RoomLinkError, type RoomLinkProblem } from "./link";
import { seededBytes } from "./random";

const secret = seededBytes(42)(32);
const key = bytesToBase64Url(secret);
const BASE = "https://www.livediagrams.dev/";
const hostKey = bytesToBase64Url(seededBytes(7)(32));

const problem = (input: string): RoomLinkProblem | "ok" => {
  try {
    parseRoomLink(input);
    return "ok";
  } catch (err) {
    if (err instanceof RoomLinkError) return err.problem;
    throw err;
  }
};

describe("room links", () => {
  it("round-trips: the secret and epoch survive formatting and parsing", () => {
    const url = formatRoomLink(BASE, { epoch: 7, secret });
    expect(url).toBe(`${BASE}#room=v1.7.${key}`);
    const room = parseRoomLink(url);
    expect(room.epoch).toBe(7);
    expect([...room.secret]).toEqual([...secret]);
  });

  it("puts nothing in the query string, and refuses a base that has one", () => {
    expect(new URL(formatRoomLink(BASE, { epoch: 0, secret })).search).toBe("");
    expect(() => formatRoomLink(`${BASE}?view=canvas`, { epoch: 0, secret })).toThrow();
    expect(() => formatRoomLink(`${BASE}#x`, { epoch: 0, secret })).toThrow();
  });

  it.each([
    ["no fragment", BASE, "missing"],
    ["a share link", `${BASE}#d=abc`, "missing"],
    ["a newer version", `${BASE}#room=v3.0.${key}`, "newer"],
    ["a v2 link without its host key", `${BASE}#room=v2.0.${key}`, "damaged"],
    ["a v1 link with a host key", `${BASE}#room=v1.0.${key}.${hostKey}`, "damaged"],
    ["a short host key", `${BASE}#room=v2.0.${key}.${hostKey.slice(1)}`, "damaged"],
    ["a long host key", `${BASE}#room=v2.0.${key}.${hostKey}A`, "damaged"],
    ["a second host key", `${BASE}#room=v2.0.${key}.${hostKey}.${hostKey}`, "damaged"],
    ["no version", `${BASE}#room=${key}`, "damaged"],
    ["a short secret", `${BASE}#room=v1.0.${key.slice(1)}`, "damaged"],
    ["a long secret", `${BASE}#room=v1.0.${key}A`, "damaged"],
    ["padding", `${BASE}#room=v1.0.${key}=`, "damaged"],
    ["standard base64 characters", `${BASE}#room=v1.0.${key.slice(0, 42)}+`, "damaged"],
    ["a leading-zero epoch", `${BASE}#room=v1.01.${key}`, "damaged"],
    ["a negative epoch", `${BASE}#room=v1.-1.${key}`, "damaged"],
    ["an epoch past u32", `${BASE}#room=v1.4294967296.${key}`, "damaged"],
    ["a percent-encoded value", `${BASE}#room=v1%2E0%2E${key}`, "damaged"],
    ["an absurdly long value", `${BASE}#room=v1.0.${"A".repeat(10_000)}`, "damaged"],
    ["two rooms", `${BASE}#room=v1.0.${key}&room=v1.0.${key}`, "ambiguous"],
    ["a room beside a share link", `${BASE}#d=abc&room=v1.0.${key}`, "ambiguous"],
    ["a room beside a password link", `${BASE}#room=v1.0.${key}&e=v1.a.b.c`, "ambiguous"],
    ["the secret in the query string", `${BASE}?room=v1.0.${key}`, "in-query"],
    ["the secret in the query, and a fragment too", `${BASE}?room=v1.0.${key}#room=v1.0.${key}`, "in-query"],
  ])("refuses %s", (_name, input, expected) => {
    expect(problem(input)).toBe(expected);
  });

  it("v2 (a signed room) round-trips its host key beside the secret and epoch; v1 has none", () => {
    const url = formatRoomLink(BASE, { epoch: 3, secret, hostKey });
    expect(url).toBe(`${BASE}#room=v2.3.${key}.${hostKey}`);
    const room = parseRoomLink(url);
    expect(room).toMatchObject({ epoch: 3, hostKey });
    expect([...room.secret]).toEqual([...secret]);
    expect(parseRoomLink(`${BASE}#room=v1.3.${key}`).hostKey).toBeUndefined();
    expect(() => formatRoomLink(BASE, { epoch: 0, secret, hostKey: "short" })).toThrow();
  });

  it("refuses a v2 host key that isn't its one canonical spelling", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const twin = alphabet[alphabet.indexOf(hostKey.at(-1)!) ^ 1];
    expect(problem(`${BASE}#room=v2.0.${key}.${hostKey.slice(0, 42)}${twin}`)).toBe("damaged");
    expect(problem(`${BASE}#room=v2.0.${key}.${hostKey}`)).toBe("ok");
  });

  it("accepts the largest epoch", () => {
    expect(parseRoomLink(`${BASE}#room=v1.4294967295.${key}`).epoch).toBe(4294967295);
  });

  it("has exactly one spelling per secret: a non-canonical last character is refused", () => {
    // The 43rd character carries 6 bits of which only 4 are data; flipping a padding bit decodes to the same bytes.
    const last = key.at(-1)!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const twin = alphabet[alphabet.indexOf(last) ^ 1];
    expect(problem(`${BASE}#room=v1.0.${key.slice(0, 42)}${twin}`)).toBe("damaged");
  });

  it("never repeats the secret in an error message", () => {
    for (const input of [`${BASE}?room=v1.0.${key}`, `${BASE}#room=v1.0.${key}&d=x`, `${BASE}#room=v9.0.${key}`]) {
      try {
        parseRoomLink(input);
      } catch (err) {
        expect(String((err as Error).message)).not.toContain(key);
        expect(String(err)).not.toContain(key.slice(0, 16));
      }
    }
  });
});

describe("consumeRoomFragment", () => {
  const fakeWindow = (search: string, hash: string) => {
    const calls: string[] = [];
    return {
      loc: { pathname: "/", search, hash },
      history: { state: null, replaceState: (_s: unknown, _u: string, url: string) => void calls.push(url) },
      calls,
    };
  };

  it("reads the room and clears the fragment from the address bar", () => {
    const w = fakeWindow("?view=canvas", `#room=v1.0.${key}`);
    const room = consumeRoomFragment(w.loc, w.history);
    expect([...room!.secret]).toEqual([...secret]);
    expect(w.calls).toEqual(["/?view=canvas"]);
  });

  it("clears a damaged room fragment too, and throws", () => {
    const w = fakeWindow("", `#room=v1.0.short`);
    expect(() => consumeRoomFragment(w.loc, w.history)).toThrow(RoomLinkError);
    expect(w.calls).toEqual(["/"]);
  });

  it("takes a secret out of the query string (it was sent to a server already) and refuses it", () => {
    const w = fakeWindow(`?view=canvas&room=v1.0.${key}`, "");
    expect(() => consumeRoomFragment(w.loc, w.history)).toThrow(/new room/);
    expect(w.calls).toEqual(["/?view=canvas"]);
  });

  it("leaves other fragments alone", () => {
    const w = fakeWindow("", "#d=abc");
    expect(consumeRoomFragment(w.loc, w.history)).toBeUndefined();
    expect(w.calls).toEqual([]);
  });
});
