import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { EditorApi } from "../editor/types";
import { localOnlyFixture } from "../lab/localOnlyFixture";

vi.mock("../examples", async () => {
  const { localOnlyFixture } = await import("../lab/localOnlyFixture");
  const examples = [
    { slug: "synthetic-local", diagram: localOnlyFixture, localOnly: true },
    {
      slug: "synthetic-generic",
      localOnly: true,
      diagram: {
        ...localOnlyFixture,
        nodes: [
          { ...localOnlyFixture.nodes[0], id: "api", label: "API", sublabel: "Service" },
          { ...localOnlyFixture.nodes[0], id: "db", label: "DB", sublabel: "Database" },
        ],
        edges: [],
      },
    },
  ];
  return { examples, getLoadedExample: (slug: string) => examples.find((e) => e.slug === slug)?.diagram };
});

import { canShareAsLink, isLocalOnly } from "./localOnly";
import { resetLocalFingerprintsForTest } from "./localOnly.dev";
import * as io from "./diagramIO";
import { describeForAi } from "../ai/privacy";
import { buildTools } from "../ai/webmcp/tools";

const unrelated = (count = 3): DiagramFile => ({
  format: "diagrams/v1",
  title: "Unrelated diagram",
  nodes: Array.from({ length: count }, (_, i) => ({
    id: `unrelated-${i}`,
    label: "Service",
    sublabel: "Database",
    stencil: "generic.service",
    x: i * 300,
    y: 0,
  })),
  edges: [],
});

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  resetLocalFingerprintsForTest();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local-only provenance and AI boundary", () => {
  it("copies source taint into index metadata and preserves it through edits, rename, duplicate and delete/undo", () => {
    // Even a copy with all distinctive content removed must retain its source's provenance.
    const saved = io.createLibraryDiagram(unrelated(), undefined, undefined, { sourceSlug: "synthetic-local" });
    expect(io.listLibrary()[0].localOnly).toBe(true);
    expect(io.getOriginal(saved)).not.toHaveProperty("localOnly");
    io.writeAutosave(saved, unrelated(1));
    io.renameLibraryDiagram(saved, "Renamed synthetic copy");
    const copy = io.duplicateLibraryDiagram(saved);
    const undo = io.deleteLibraryDiagram(saved);
    expect(undo()).toBe(true);
    for (const slug of [saved, copy]) {
      expect(io.isLocalOnlySource(slug)).toBe(true);
      expect(isLocalOnly({ localOnly: io.isLocalOnlySource(slug) })).toBe(true);
    }
    // Index provenance still blocks after switching off dev content detection.
    vi.stubEnv("DEV", false);
    expect(io.isLocalOnlySource(copy)).toBe(true);
  });

  it("duplicates a local example directly and taints imports, pasted copies and draft promotion", () => {
    const duplicate = io.duplicateLibraryDiagram("synthetic-local");
    expect(io.isLocalOnlySource(duplicate)).toBe(true);
    const imported = io.parseDiagram(JSON.stringify(localOnlyFixture));
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error(imported.error);
    const slug = io.createLibraryDiagram(imported.diagram);
    expect(io.isLocalOnlySource(slug)).toBe(true);
    expect(isLocalOnly({ diagram: { ...localOnlyFixture, title: "Pasted into another diagram" } })).toBe(true);
    io.newDraft();
    io.writeAutosave(io.DRAFT_SLUG, localOnlyFixture);
    expect(io.isLocalOnlySource(io.DRAFT_SLUG)).toBe(true);
  });

  it("checks current content for prompts and retained tool callbacks, including share links", async () => {
    let diagram = unrelated();
    const editor = { getDiagram: () => diagram, applyDiagram: vi.fn() } as unknown as EditorApi;
    const canvas = { editor };
    const shareLink = vi.fn(async () => ({ url: "synthetic", length: 9 }));
    const tools = buildTools({
      getEditor: () => editor,
      canUseAi: () => !isLocalOnly(canvas),
      onApplied: vi.fn(),
      newDiagram: async () => editor,
      shareLink,
    });
    expect(isLocalOnly(canvas)).toBe(false);
    expect(describeForAi(editor, canvas)).toContain("Unrelated diagram");
    diagram = localOnlyFixture;
    expect(describeForAi(editor, canvas)).toContain("Local-only");
    expect(describeForAi(editor, canvas)).not.toContain("SYNTHETIC_ORCHID_ROUTER");
    for (const name of ["describe_diagram", "check_diagram", "edit_diagram", "set_simulation", "get_share_link"]) {
      await expect(Promise.resolve().then(() => tools.find((tool) => tool.name === name)!.run({}))).rejects.toThrow(
        "Local-only",
      );
    }
    expect(shareLink).not.toHaveBeenCalled();
    expect(editor.applyDiagram).not.toHaveBeenCalled();
  });
});

describe("dev-only content fingerprints", () => {
  it("counts matching nodes once and applies either the three-node or 20% threshold", () => {
    const d = unrelated(20);
    d.nodes[0] = localOnlyFixture.nodes[0];
    expect(isLocalOnly({ diagram: d })).toBe(false);
    d.nodes[1] = localOnlyFixture.nodes[1];
    expect(isLocalOnly({ diagram: d })).toBe(false);
    d.nodes[2] = localOnlyFixture.nodes[2];
    expect(isLocalOnly({ diagram: d })).toBe(true);
    expect(
      isLocalOnly({
        diagram: { ...d, nodes: d.nodes.slice(0, 5).map((node, i) => (i ? unrelated().nodes[0] : node)) },
      }),
    ).toBe(true);
    expect(isLocalOnly({ diagram: { ...d, nodes: [] } })).toBe(false);
  });

  it("recognizes ids, sublabels and incident edge labels with normalization", () => {
    const d = unrelated();
    d.nodes[0].sublabel = "  SYNTHETIC   VIOLET CHANNEL  ";
    expect(isLocalOnly({ diagram: d })).toBe(true);
    delete d.nodes[0].sublabel;
    d.nodes[0].id = localOnlyFixture.nodes[0].id;
    expect(isLocalOnly({ diagram: d })).toBe(true);
    d.nodes[0].id = "unrelated-0";
    d.edges = [{ ...localOnlyFixture.edges[0], from: d.nodes[0].id, to: d.nodes[1].id }];
    expect(isLocalOnly({ diagram: d })).toBe(true);
  });

  it("ignores short and generic strings, allows unrelated diagrams, and never reads content in production", () => {
    expect(isLocalOnly({ diagram: unrelated() })).toBe(false);
    expect(
      isLocalOnly({ diagram: { ...unrelated(), nodes: [{ ...unrelated().nodes[0], label: "API", sublabel: "DB" }] } }),
    ).toBe(false);
    vi.stubEnv("DEV", false);
    const getDiagram = vi.fn(() => localOnlyFixture);
    expect(isLocalOnly({ editor: { getDiagram } })).toBe(false);
    expect(getDiagram).not.toHaveBeenCalled();
  });
});

describe("canShareAsLink", () => {
  it("is the one gate for every link: a local-only diagram gets none, any other diagram may", () => {
    expect(canShareAsLink({ localOnly: true })).toBe(false);
    expect(canShareAsLink({ localOnly: false, diagram: { ...localOnlyFixture, nodes: [], edges: [] } })).toBe(true);
    expect(canShareAsLink(null)).toBe(true);
    expect(canShareAsLink(undefined)).toBe(true);
  });
});
