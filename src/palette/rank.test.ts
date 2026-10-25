import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../stencils/catalog";
import { flatten, MAX_RESULTS, parseQuery, rank, recencyBoost, type Command } from "./rank";
import { stencilScore } from "./sources";
import { rememberable, withRecentCommand } from "./recent";
import { ActionRegistry } from "../editor/actions";
import { annotateMenu, builtinActions } from "../editor/builtinActions";
import type { EditorApi } from "../editor/types";
import { collectCommands } from "./sources";

beforeEach(() => {
  vi.spyOn(console, "error");
});
afterEach(() => {
  try {
    expect(console.error).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
  }
});

const action = (id: string, label: string, extra: Partial<Command> = {}): Command => ({
  id: `action:${id}`,
  group: "actions",
  label,
  ...extra,
});

const stencilCommands: Command[] = catalog.map((s) => ({
  id: `stencil:${s.id}`,
  group: "stencils",
  label: `Add ${s.label}`,
  idle: false,
  score: (q) => stencilScore(s, q),
}));

const ids = (cs: Command[], q: string, recent: string[] = []) => flatten(rank(cs, q, recent)).map((c) => c.id);

describe("palette ranking", () => {
  it("keeps both shape catalogs collapsed with a shape selected", () => {
    const registry = new ActionRegistry();
    registry.register(builtinActions());
    const editor = {
      getSelection: () => ({ nodeIds: ["shape"], edgeIds: [], groupIds: [] }),
      getDiagram: () => ({ nodes: [], edges: [] }),
      getAnnotation: () => ({ kind: "shape", shape: "tri" }),
      getNode: () => undefined,
      hasClipboard: () => false,
      canUndo: () => false,
      canRedo: () => false,
      prefs: { snap: true, grid: true, minimap: false, inspector: true },
    } as unknown as EditorApi;
    const commands = collectCommands({
      registry,
      canvas: { editor, live: false, addStencil: () => "", focusNode: () => {}, openPicker: () => {} },
      live: null,
      view: "canvas",
      stencils: [],
      recentStencils: [],
      diagrams: [],
      openDiagram: () => {},
      sendStencilToCanvas: () => {},
      runSimulation: () => {},
    });
    const browsed = ids(commands, ">");
    expect(browsed).toContain("action:canvas.add-shape");
    expect(browsed).toContain("action:annotation.shape");
    expect(browsed.some((id) => id.startsWith("action:annotation-shape:"))).toBe(false);
    expect(ids(commands, "> hexagon")).toContain("action:annotation-shape:hexagon");
  });
  it("browses one shape entry without crowding out core actions, and searches individual shapes", () => {
    const registry = new ActionRegistry();
    registry.register([
      {
        id: "canvas.annotate",
        section: "insert",
        targets: ["canvas"],
        label: "Annotate",
        children: () => annotateMenu(() => {}),
      },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `core-${i}`,
        section: "insert",
        targets: ["canvas"] as const,
        label: `Core ${i}`,
      })),
      { id: "canvas.fit", section: "insert", targets: ["canvas"], label: "Fit view" },
    ]);
    const editor = {
      getSelection: () => ({ nodeIds: [], edgeIds: [], groupIds: [] }),
      getDiagram: () => ({ nodes: [] }),
    } as unknown as EditorApi;
    const commands = collectCommands({
      registry,
      canvas: { editor, live: false, addStencil: () => "", focusNode: () => {}, openPicker: () => {} },
      live: null,
      view: "canvas",
      stencils: [],
      recentStencils: [],
      diagrams: [],
      openDiagram: () => {},
      sendStencilToCanvas: () => {},
      runSimulation: () => {},
    });
    const shapeIds = commands.filter((c) => c.id.includes("shape")).map((c) => c.id);
    for (const query of ["", ">", " >   "]) {
      const browsed = ids(commands, query, ["action:annotate-shape:hexagon"]);
      expect(browsed).toContain("action:canvas.fit");
      expect(browsed.filter((id) => shapeIds.includes(id))).toEqual(["action:canvas.add-shape"]);
    }
    for (const query of ["hexagon", "> hexagon", "prepare"]) {
      expect(ids(commands, query)[0]).toBe("action:annotate-shape:hexagon");
    }
  });

  it("caps empty queries across diagrams, simulations and recents", () => {
    for (const group of ["diagrams", "simulations"] as const) {
      const commands = Array.from({ length: 1000 }, (_, i): Command => ({
        id: `${group}:${i}`,
        group,
        label: `Item ${i}`,
      }));
      const results = flatten(
        rank(
          commands,
          "",
          commands.slice(0, 5).map((c) => c.id),
        ),
      );
      expect(results).toHaveLength(MAX_RESULTS);
      expect(new Set(results.map((c) => c.id)).size).toBe(MAX_RESULTS);
    }
  });
  const actions = [
    action("canvas.auto-layout", "Auto-layout"),
    action("live", "Toggle live"),
    action("node.rename", "Rename node"),
    action("canvas.fit", "Fit view"),
    action("export:drawio", "Export › draw.io", { keywords: "Export", idle: false }),
  ];

  it("puts prefix hits above subsequence hits", () => {
    expect(ids(actions, "tog")[0]).toBe("action:live");
    expect(ids(actions, "lay")[0]).toBe("action:canvas.auto-layout");
    // "tl" is both an acronym of Toggle live and a scattered subsequence of other labels.
    expect(ids(actions, "tl")[0]).toBe("action:live");
  });

  it("finds stencils by alias, best first", () => {
    const pool = [...actions, ...stencilCommands];
    expect(ids(pool, "sb").slice(0, 2).sort()).toEqual([
      "stencil:azure.service-bus.queue",
      "stencil:azure.service-bus.topic",
    ]);
    expect(ids(pool, "pg")[0]).toBe("stencil:postgres");
    expect(ids(pool, "add kafka topic")[0]).toBe("stencil:kafka.topic");
  });

  it("drops the weak tail once there's a clear hit", () => {
    const pool = [action("live", "Toggle live"), action("x", "Totally unrelated glove")];
    expect(ids(pool, "tog")).toEqual(["action:live"]);
  });

  it("boosts recently used commands", () => {
    const twins = [action("a", "Copy node"), action("b", "Copy selection")];
    expect(ids(twins, "copy")[0]).toBe("action:a");
    expect(ids(twins, "copy", ["action:b"])[0]).toBe("action:b");
    expect(recencyBoost(0)).toBeGreaterThan(recencyBoost(3));
    expect(recencyBoost(-1)).toBe(0);
    // A strong match still beats a weak recent one.
    expect(ids(actions, "fit", ["action:canvas.auto-layout"])[0]).toBe("action:canvas.fit");
  });

  it("shows recently used first for an empty query, without repeating them", () => {
    const ranked = rank(actions, "", ["action:canvas.fit", "action:missing"]);
    expect(ranked[0].group).toBe("recent");
    expect(ranked[0].items.map((c) => c.id)).toEqual(["action:canvas.fit"]);
    expect(flatten(ranked).filter((c) => c.id === "action:canvas.fit")).toHaveLength(1);
  });

  it("hides submenu leaves until the user types", () => {
    expect(ids(actions, "")).not.toContain("action:export:drawio");
    expect(ids(actions, "drawio")).toContain("action:export:drawio");
    expect(ids(actions, "export draw")).toContain("action:export:drawio");
  });

  it("orders groups by their best hit", () => {
    const pool = [...actions, { id: "node:fit", group: "nodes", label: "Fitness service" } as Command];
    const exact = rank(pool, "fit view");
    expect(exact[0].group).toBe("actions");
    const nodeFirst = rank(pool, "fitness");
    expect(nodeFirst[0].group).toBe("nodes");
  });

  it("narrows by prefix: > actions, @ nodes, + stencils", () => {
    expect(parseQuery("> fit")).toEqual({ query: "fit", only: "actions" });
    expect(parseQuery("@pay")).toEqual({ query: "pay", only: "nodes" });
    expect(parseQuery("+ sb")).toEqual({ query: "sb", only: "stencils" });
    expect(parseQuery(" rename ")).toEqual({ query: "rename" });

    const pool = [...actions, { id: "node:live", group: "nodes", label: "Live orders" } as Command, ...stencilCommands];
    expect(new Set(flatten(rank(pool, "@live")).map((c) => c.group))).toEqual(new Set(["nodes"]));
    expect(new Set(flatten(rank(pool, ">live")).map((c) => c.group))).toEqual(new Set(["actions"]));
    expect(new Set(flatten(rank(pool, "+")).map((c) => c.group))).toEqual(new Set(["stencils"]));
    // A bare prefix lists the whole kind, leaves included.
    expect(ids(pool, ">")).toContain("action:export:drawio");
  });

  it("keeps the recent list de-duplicated and capped", () => {
    expect(withRecentCommand(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(withRecentCommand(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("never remembers a command marked as carrying a private diagram's words", () => {
    expect(rememberable({ documentScoped: true }, true)).toBe(false);
    expect(rememberable({ documentScoped: true }, false)).toBe(true);
    expect(rememberable({}, true)).toBe(true);
  });
});
