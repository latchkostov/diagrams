import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { validateDiagram } from "../interop/native";
import {
  decryptBytes,
  encodeEncryptedShare,
  ENCRYPTION_VERSION,
  IV_BYTES,
  parseEncrypted,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
} from "../interop/shareCrypto";
import { bytesToText, deflateRaw, inflateRaw, textToBytes } from "../interop/codec";
import { encryptBytes } from "../interop/passwordCrypto";
import { unlockPayloadText } from "./lock";
import { buildPayload, htmlFileName, injectLocked, LOCKED_TITLE, PAYLOAD_BLOCK, type ExportInput } from "./inject";
import { lockedFileName, lockPayload, MIN_PASSWORD_LENGTH, UnlockError, WRONG_FILE_PASSWORD } from "./lock";
import { parsePayload, unlockPayload, type LockedFile } from "./viewer/payload";

// Password-protected Interactive HTML (./lock.ts): the file carries the payload encrypted with password links' own
// crypto, and nothing of the diagram in the clear. The real template (the agent skill's committed copy), so the
// leak check covers everything the file is made of.

// PBKDF2 at 600,000 iterations takes a noticeable fraction of a second per derivation, by design.
const SLOW = { timeout: 60_000 };

const TEMPLATE = readFileSync(path.join(process.cwd(), "skills/livediagrams/scripts/lib/viewer-template.html"), "utf8");
const SVGS = { kafka: "<svg><path d='M1 1'/></svg>", "generic-box": "<svg><rect/></svg>" };

const PASSWORD = "quartz meadow tangle 81";

/** Every string of the diagram, distinctive enough that finding one anywhere in the file can only be a leak. */
const SECRET = {
  title: "Zorblax settlement ledger",
  description: "Quibbleworth reconciles nightly",
  nodeId: "vexmora-api",
  nodeLabel: "Vexmora payments API",
  sublabel: "fintrenzo-prod-weu",
  propValue: "kubrillo-cluster-7",
  topicId: "plonkett-topic",
  topicLabel: "Plonkett invoices",
  edgeId: "drizzlewick-edge",
  edgeLabel: "Glimmerhaw settled",
  groupId: "snorvane-group",
  groupLabel: "Snorvane subscription",
  note: "Wobbleflint owns this",
  simId: "yarrowgast-sim",
  simTitle: "Yarrowgast month end",
  banner: "Thrumbleton confidential",
};

const DIAGRAM = {
  format: "diagrams/v1",
  title: SECRET.title,
  description: SECRET.description,
  private: true,
  groups: [{ id: SECRET.groupId, label: SECRET.groupLabel, x: -40, y: -60, width: 560, height: 220 }],
  nodes: [
    {
      id: SECRET.nodeId,
      stencil: "generic.service",
      label: SECRET.nodeLabel,
      sublabel: SECRET.sublabel,
      x: 0,
      y: 0,
      props: { cluster: SECRET.propValue },
    },
    { id: SECRET.topicId, stencil: "kafka.topic", label: SECRET.topicLabel, x: 320, y: 0 },
  ],
  edges: [{ id: SECRET.edgeId, from: SECRET.nodeId, to: SECRET.topicId, kind: "async", label: SECRET.edgeLabel }],
  annotations: [{ id: "n1", kind: "note", text: SECRET.note, x: 0, y: 200, width: 200, height: 80 }],
  simulations: [
    {
      id: SECRET.simId,
      title: SECRET.simTitle,
      traffic: [{ id: "in", node: SECRET.nodeId, shape: { kind: "constant", ratePerSec: 5, durationMs: 1000 } }],
    },
  ],
} as unknown as DiagramFile;

const input: ExportInput = {
  diagram: DIAGRAM,
  iconSvgs: SVGS,
  theme: "dark",
  banner: SECRET.banner,
  startSimulation: SECRET.simId,
  exportedOn: "2026-10-12",
};

/** The data block's JSON, as the viewer reads it. */
const block = (html: string) => {
  const open = '<script type="application/json" id="diagram">';
  const from = html.indexOf(open) + open.length;
  return html.slice(from, html.indexOf("</script>", from));
};

async function lockedFile(password = PASSWORD) {
  const payload = buildPayload(TEMPLATE, input);
  const html = injectLocked(TEMPLATE, await lockPayload(payload, password));
  const read = parsePayload(block(html));
  if (!read.locked) throw new Error("Not a locked file");
  return { payload, html, locked: read.locked };
}

afterEach(() => vi.restoreAllMocks());

describe("password-protected Interactive HTML", () => {
  it("the fixture is a whole diagram the viewer would show", () => {
    expect(validateDiagram(DIAGRAM).ok).toBe(true);
  });

  it("round-trips: encrypted by the export, decrypted by the viewer into the same payload", SLOW, async () => {
    const { payload, html, locked } = await lockedFile();
    expect(locked.theme).toBe("dark");
    const opened = await unlockPayload(locked, PASSWORD);
    // The viewer's own reading of the plain payload: the same diagram, icons and options.
    const plain = parsePayload(JSON.stringify(payload));
    expect(opened).toEqual(plain);
    expect(opened.diagram.private).toBe(true);
    expect(opened.options.banner).toBe(SECRET.banner);
    expect(opened.options.startSimulation).toBe(SECRET.simId);
    expect(Object.keys(opened.icons).sort()).toEqual(["generic-box", "kafka"]);
    // The page: one data block, the neutral title, the theme for the prompt, the script untouched.
    expect(html.split('<script type="application/json" id="diagram">')).toHaveLength(2);
    expect(html).not.toContain(PAYLOAD_BLOCK);
    expect(html).toContain(`<title>${LOCKED_TITLE}</title>`);
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(htmlFileName(LOCKED_TITLE)).toBe("Diagram (password protected).html");
  });

  it("names each protected file apart, from random bytes only: never the diagram, never twice the same", () => {
    expect(lockedFileName(Uint8Array.from([0, 1, 2, 30, 31]))).toBe("Diagram (password protected) 234z2.html");
    const names = new Set(Array.from({ length: 200 }, () => lockedFileName()));
    expect(names.size).toBe(200);
    for (const name of names) expect(name).toMatch(/^Diagram \(password protected\) [a-z2-9]{5}\.html$/);
  });

  it("a wrong password fails with the file's own message, and can be retried", SLOW, async () => {
    const { locked } = await lockedFile();
    const wrong = await unlockPayload(locked, "quartz meadow tangle 18").catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(UnlockError);
    expect((wrong as UnlockError).wrong).toBe(true);
    expect((wrong as UnlockError).message).toBe(WRONG_FILE_PASSWORD);
    expect((await unlockPayload(locked, PASSWORD)).diagram.title).toBe(SECRET.title);
  });

  // The right password, but what it decrypts to is wrong: authenticated, so only a broken exporter (or someone who
  // has the password) could make one. The viewer must still say so, never show a blank page.
  /** `plain` encrypted with PASSWORD, as a locked file's block holds it. */
  const sealed = async (plain: Uint8Array): Promise<LockedFile> => ({
    token: await encryptBytes(plain, PASSWORD),
    theme: "light",
  });
  const unlockError = (locked: LockedFile): Promise<UnlockError> =>
    unlockPayload(locked, PASSWORD).then(
      () => {
        throw new Error("It opened");
      },
      (e: unknown) => e as UnlockError,
    );

  it("rejects authenticated invalid compressed data", SLOW, async () => {
    const err = await unlockError(await sealed(textToBytes("not deflate at all, just text")));
    expect(err).toBeInstanceOf(UnlockError);
    expect(err.wrong).toBe(false);
    expect(err.message).toMatch(/damaged/);
  });

  it("rejects authenticated invalid JSON, and an invalid diagram, with the viewer's own reason", SLOW, async () => {
    const notJson = await unlockError(await sealed(await deflateRaw(textToBytes("{ not json"))));
    expect(notJson).toBeInstanceOf(UnlockError);
    expect(notJson.wrong).toBe(false);
    expect(notJson.message).toMatch(/damaged/);

    const payload = buildPayload(TEMPLATE, input);
    const broken = { ...payload, diagram: { ...payload.diagram, nodes: "none" } };
    const badDiagram = await unlockError(await sealed(await deflateRaw(textToBytes(JSON.stringify(broken)))));
    expect(badDiagram).toBeInstanceOf(UnlockError);
    expect(badDiagram.wrong).toBe(false);
    expect(badDiagram.message).toBe(parsePayload(JSON.stringify(broken)).error);
    expect(badDiagram.message).toBeTruthy();

    // A locked block inside a locked block isn't a diagram either.
    const nested = { version: 1, encrypted: "v1.a.b.c", theme: "light" };
    const inner = await unlockError(await sealed(await deflateRaw(textToBytes(JSON.stringify(nested)))));
    expect(inner).toBeInstanceOf(UnlockError);
    expect(inner.message).toMatch(/damaged/);
  });

  it("enforces the encrypted payload inflation budget", SLOW, async () => {
    const { locked } = await lockedFile();
    const err = await unlockPayloadText(locked.token, PASSWORD, 1_000).then(
      () => new UnlockError("It opened", true),
      (e: unknown) => e as UnlockError,
    );
    expect(err).toBeInstanceOf(UnlockError);
    expect(err.wrong).toBe(false);
    expect(err.message).toMatch(/damaged/);
    // The same file within budget opens.
    expect(JSON.parse(await unlockPayloadText(locked.token, PASSWORD, 50_000_000)).version).toBe(1);
  });

  it("a damaged file says so (and isn't a wrong password)", SLOW, async () => {
    const { locked } = await lockedFile();
    const [v, salt, iv] = locked.token.split(".");
    for (const token of ["v1.abc", `${v}.${salt}.${iv}.AAAA`, "v9.a.b.c"]) {
      const err = await unlockPayload({ ...locked, token }, PASSWORD).catch((e: unknown) => e);
      expect(err, token).toBeInstanceOf(UnlockError);
      expect((err as UnlockError).wrong, token).toBe(false);
      expect((err as UnlockError).message, token).toMatch(/damaged/);
    }
    // An empty or non-string token is refused as it's read.
    expect(parsePayload(JSON.stringify({ version: 1, encrypted: "", theme: "light" }))).toMatchObject({ ok: false });
    expect(parsePayload(JSON.stringify({ version: 1, encrypted: 7 })).error).toMatch(/damaged/);
  });

  it(
    "leaks nothing: no title, label, id, note, property, simulation or banner anywhere in the file",
    SLOW,
    async () => {
      const { html, locked } = await lockedFile();
      const lower = html.toLowerCase();
      for (const [what, text] of Object.entries(SECRET)) {
        expect(lower.includes(text.toLowerCase()), what).toBe(false);
        // Not even its made-up first word ("Zorblax", "vexmora").
        const word = text.split(/[\s-]+/)[0].toLowerCase();
        expect(lower.includes(word), `${what}: ${word}`).toBe(false);
      }
      // The data block is the token and the theme, nothing else: not the private flag, the icons or the date.
      expect(JSON.parse(block(html))).toEqual({ version: 1, encrypted: locked.token, theme: "dark" });
      expect(block(html)).not.toMatch(/private|data:image|2026-10-12/);
    },
  );

  it("uses exactly password links' parameters", SLOW, async () => {
    // The token is a password link's v1 token, and the link's own decryption opens it.
    const { payload, locked } = await lockedFile();
    const parts = parseEncrypted(locked.token);
    expect(parts.version).toBe(ENCRYPTION_VERSION);
    expect(parts.salt).toHaveLength(SALT_BYTES);
    expect(parts.iv).toHaveLength(IV_BYTES);
    const plain = bytesToText(await inflateRaw(await decryptBytes(locked.token, PASSWORD)));
    expect(JSON.parse(plain)).toEqual(payload);

    // And WebCrypto is called the same way for a file as for a link (salt and IV aside).
    const subtle = globalThis.crypto.subtle;
    const derive = vi.spyOn(subtle, "deriveKey");
    const encrypt = vi.spyOn(subtle, "encrypt");
    const calls = () => ({
      derive: derive.mock.calls.map(([alg, , key]) => ({ ...(alg as Pbkdf2Params), salt: undefined, key })),
      encrypt: encrypt.mock.calls.map(([alg]) => ({ ...(alg as AesGcmParams), iv: undefined })),
    });
    await encodeEncryptedShare(DIAGRAM, PASSWORD);
    const link = calls();
    derive.mockClear();
    encrypt.mockClear();
    await lockPayload(buildPayload(TEMPLATE, input), PASSWORD);
    const file = calls();
    expect(file).toEqual(link);
    expect(file.derive).toEqual([
      { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: undefined, key: expect.anything() },
    ]);
    expect(file.derive[0].key).toEqual({ name: "AES-GCM", length: 256 });
    expect(file.encrypt).toHaveLength(1);
    expect(file.encrypt[0]).toMatchObject({ name: "AES-GCM", tagLength: 128 });
  });

  it("needs a password as long as a link's", async () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    await expect(lockPayload(buildPayload(TEMPLATE, input), short)).rejects.toThrow(/at least 8 characters/);
  });

  it("a fresh salt and IV every time: two exports of one diagram share nothing", SLOW, async () => {
    const [a, b] = await Promise.all([lockedFile(), lockedFile()]);
    expect(a.locked.token).not.toBe(b.locked.token);
    const [, saltA, ivA] = a.locked.token.split(".");
    const [, saltB, ivB] = b.locked.token.split(".");
    expect([saltA, ivA]).not.toEqual([saltB, ivB]);
  });
});

describe("the viewer reading a locked file", () => {
  it("keeps the theme, and only light or dark", () => {
    const read = (theme: unknown) =>
      (parsePayload(JSON.stringify({ version: 1, encrypted: "v1.a.b.c", theme })).locked as LockedFile).theme;
    expect(read("dark")).toBe("dark");
    expect(read("light")).toBe("light");
    expect(read("<script>")).toBe("light");
  });

  it("a newer file's version is refused before anything else", () => {
    expect(parsePayload(JSON.stringify({ version: 2, encrypted: "v1.a.b.c" })).error).toMatch(/newer version/);
  });
});
