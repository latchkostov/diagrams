import { beforeEach, describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";

// Private diagrams: the one privacy decision (src/lib/localOnly.ts) and how the Private switch travels
// with a diagram (library metadata, copies, files, the draft, the clipboard). Node has no localStorage:
// a Map stands in, installed before the modules that read it are imported.

const data = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  get length() {
    return data.size;
  },
  key: (i: number) => [...data.keys()][i] ?? null,
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
};

const io = await import("./diagramIO");
const { canSaveToCloud, canShareAsLink, canUseOnDevice, isLocalOnly, privacyOf } = await import("./localOnly");
const { newDiagramsPrivate } = await import("./privacyPrefs");
const { makePayload, parsePayload } = await import("../editor/clipboard");
const { parseNative, preserveUnknown } = await import("../interop/native");

const work: DiagramFile = {
  format: "diagrams/v1",
  title: "Work system",
  nodes: [
    { id: "api", stencil: "generic.service", label: "API", x: 0, y: 0 },
    { id: "db", stencil: "postgres", label: "Orders DB", x: 300, y: 0 },
  ],
  edges: [{ id: "e1", from: "api", to: "db" }],
};

beforeEach(() => {
  data.clear();
  newDiagramsPrivate.set(false);
  io.newDraft();
});

describe("the privacy decision", () => {
  it("a public diagram passes every gate", () => {
    for (const state of [null, undefined, {}, { private: false }]) {
      expect(privacyOf(state)).toBeNull();
      expect(isLocalOnly(state)).toBe(false);
      expect(canShareAsLink(state)).toBe(true);
      expect(canSaveToCloud(state)).toBe(true);
      expect(canUseOnDevice(state)).toBe(true);
    }
  });

  it("a private diagram blocks links, cloud saves and AI; the on-device model only once allowed", () => {
    const state = { private: true };
    expect(privacyOf(state)).toBe("private");
    expect(isLocalOnly(state)).toBe(true);
    expect(canShareAsLink(state)).toBe(false);
    expect(canSaveToCloud(state)).toBe(false);
    expect(canUseOnDevice(state)).toBe(false);
    expect(canUseOnDevice({ private: true, onDevice: true })).toBe(true);
  });

  it("local-only provenance wins over the switch and never allows the on-device model", () => {
    const state = { localOnly: true, private: true, onDevice: true };
    expect(privacyOf(state)).toBe("local-only");
    expect(canShareAsLink(state)).toBe(false);
    expect(canSaveToCloud(state)).toBe(false);
    expect(canUseOnDevice(state)).toBe(false);
    // An allowance on a diagram that isn't private means nothing.
    expect(privacyOf({ onDevice: true })).toBeNull();
  });
});

describe("the Private switch in Your diagrams", () => {
  it("is kept in the entry, survives edits and rename, and turning it off withdraws the on-device allowance", () => {
    const slug = io.createLibraryDiagram(work);
    expect(io.getPrivacyFlags(slug).private).toBeFalsy();
    expect(io.setDiagramPrivate(slug, true)).toBe(true);
    expect(io.listLibrary()[0].private).toBe(true);
    expect(io.setOnDeviceAllowed(slug, true)).toBe(true);
    io.writeAutosave(slug, { ...work, title: "Edited" });
    io.renameLibraryDiagram(slug, "Renamed");
    expect(io.getPrivacyFlags(slug)).toMatchObject({ private: true, onDevice: true });
    expect(io.isLocalOnlySource(slug)).toBe(true);
    // The stored document never carries the flag; the entry does.
    expect(io.getCurrent(slug)).not.toHaveProperty("private");
    expect(io.setDiagramPrivate(slug, false)).toBe(true);
    expect(io.getPrivacyFlags(slug)).toEqual({});
    expect(io.setOnDeviceAllowed(slug, true)).toBe(true);
    expect(io.getPrivacyFlags(slug).onDevice).toBeFalsy();
  });

  it("copies, duplicates and delete/undo keep it", () => {
    const slug = io.createLibraryDiagram(work, undefined, undefined, { private: true });
    const duplicate = io.duplicateLibraryDiagram(slug);
    const copy = io.createLibraryDiagram(work, undefined, undefined, { sourceSlug: slug });
    for (const s of [duplicate, copy]) {
      expect(io.getPrivacyFlags(s).private).toBe(true);
      // Still the person's switch, never the built-in "always private".
      expect(io.getPrivacyFlags(s).localOnly).toBeFalsy();
      expect(io.setDiagramPrivate(s, false)).toBe(true);
      expect(io.isLocalOnlySource(s)).toBe(false);
    }
    const undo = io.deleteLibraryDiagram(slug);
    expect(undo()).toBe(true);
    expect(io.getPrivacyFlags(slug).private).toBe(true);
  });

  it("has no switch on examples and shared diagrams; a shared file that says private is private", () => {
    expect(io.setDiagramPrivate("kafka-order-pipeline", true)).toBe(false);
    io.setShared({ ...work, private: true });
    expect(io.getPrivacyFlags(io.SHARED_SLUG).private).toBe(true);
    // Save a copy from the shared slot keeps it.
    const kept = io.createLibraryDiagram(io.getCurrent(io.SHARED_SLUG)!, undefined, undefined, {
      sourceSlug: io.SHARED_SLUG,
    });
    expect(io.getPrivacyFlags(kept).private).toBe(true);
  });
});

describe("files", () => {
  it("an export says private, and importing it again is private", () => {
    const exported = io.withPrivacyField(work, true);
    expect(exported.private).toBe(true);
    const parsed = parseNative(JSON.stringify(exported));
    if (!parsed.ok) throw new Error(parsed.error);
    const slug = io.createLibraryDiagram(parsed.diagram);
    expect(io.getPrivacyFlags(slug).private).toBe(true);
    expect(io.getOriginal(slug)).not.toHaveProperty("private");
    // A public diagram's export never says private, even over a stale field.
    expect(io.withPrivacyField({ ...work, private: true }, false)).not.toHaveProperty("private");
  });

  it("the field fails closed and is never carried over from a stored original", () => {
    const odd = parseNative(JSON.stringify({ ...work, private: "yes" }));
    if (!odd.ok) throw new Error(odd.error);
    expect(odd.diagram.private).toBe(true);
    expect(odd.warnings?.join(" ")).toMatch(/kept private/);
    const off = parseNative(JSON.stringify({ ...work, private: false }));
    if (!off.ok) throw new Error(off.error);
    expect(off.diagram).not.toHaveProperty("private");
    expect(preserveUnknown(work, { ...work, private: true })).not.toHaveProperty("private");
  });
});

describe("new diagrams", () => {
  it("the blank draft follows the setting, keeps its switch when it becomes an entry, and so does createDiagram", () => {
    expect(io.getPrivacyFlags(io.DRAFT_SLUG).private).toBeFalsy();
    newDiagramsPrivate.set(true);
    io.newDraft();
    expect(io.getPrivacyFlags(io.DRAFT_SLUG).private).toBe(true);
    expect(io.isLocalOnlySource(io.DRAFT_SLUG)).toBe(true);
    io.writeAutosave(io.DRAFT_SLUG, work);
    const promoted = io.resolveSlug(io.DRAFT_SLUG);
    expect(promoted).not.toBe(io.DRAFT_SLUG);
    expect(io.getPrivacyFlags(promoted).private).toBe(true);
    expect(io.getPrivacyFlags(io.createDiagram({ title: "Seeded" })).private).toBe(true);
  });

  it("the draft's own switch, before its first edit", () => {
    expect(io.setDiagramPrivate(io.DRAFT_SLUG, true)).toBe(true);
    expect(io.getPrivacyFlags(io.DRAFT_SLUG).private).toBe(true);
    io.newDraft();
    expect(io.getPrivacyFlags(io.DRAFT_SLUG).private).toBeFalsy();
  });

  it("the setting is remembered", () => {
    newDiagramsPrivate.set(true);
    expect(data.get("diagrams.newDiagramsPrivate.v1")).toBe("1");
    newDiagramsPrivate.set(false);
    expect(data.has("diagrams.newDiagramsPrivate.v1")).toBe(false);
  });
});

describe("the clipboard carries privacy", () => {
  it("a copy from a private diagram says so, in-app and through the system clipboard's JSON", () => {
    const p = makePayload(work, ["api", "db"], [], true);
    expect(p?.private).toBe(true);
    expect(parsePayload(JSON.stringify(p))?.private).toBe(true);
    expect(makePayload(work, ["api"])).not.toHaveProperty("private");
    // A whole private file pasted onto a canvas is private content too; odd values fail closed.
    expect(parsePayload(JSON.stringify({ ...work, private: true }))?.private).toBe(true);
    expect(parsePayload(JSON.stringify({ ...work, private: 1 }))?.private).toBe(true);
    expect(parsePayload(JSON.stringify({ ...work, private: false }))).not.toHaveProperty("private");
  });
});
