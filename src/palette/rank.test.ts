import { describe, expect, it } from "vitest";
import { catalog } from "../stencils/catalog";
import { flatten, MAX_RESULTS, parseQuery, rank, recencyBoost, type Command } from "./rank";
import { stencilScore } from "./sources";
import { rememberable, withRecentCommand } from "./recent";

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
