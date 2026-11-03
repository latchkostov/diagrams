import { expect, it, vi } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { LiveController } from "../live/controller";
import { planningHost } from "../live/planningHost";
import type { EditorApi } from "./types";
import type { ActionContext, MenuItem } from "./actions";
import { builtinActions } from "./builtinActions";
import { effectiveCachePolicy } from "./cachePolicy";
import { coalesceRule } from "../sim/cachePresets";
import type { CacheTable } from "../model/caching";
import "../live/cacheOriginMenu";

function fixture() {
  const diagram = cacheFixture();
  const editor = {
    getDiagram: () => diagram,
    getEdge: (id: string) => diagram.edges.find((e) => e.id === id),
    getNode: (id: string) => diagram.nodes.find((n) => n.id === id),
    setNodeProps: vi.fn<EditorApi["setNodeProps"]>((id, patch) => {
      Object.assign(diagram.nodes.find((n) => n.id === id)!.props!, patch);
    }),
    updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
    select: vi.fn(),
    openInspector: vi.fn(),
  };
  return { diagram, editor };
}

it.each([false, true])("origin edits preserve tuned policies and their document owner (saved=%s)", (saved) => {
  const { diagram, editor } = fixture();
  const table: CacheTable = {
    rules: [{ id: "hot", match: { path: { kind: "exact", value: "/products/1" } }, policy: { ttlMs: 5700, keys: 1 } }],
    default: { noStore: true },
  };
  diagram.nodes[1].props!.cache = table;
  diagram.simulations = [{ id: "run", title: "Run", traffic: [], setup: { props: { cache: { latencyMs: 17 } } } }];
  const controller = new LiveController(diagram);
  if (saved) controller.selectSimulation(diagram.simulations[0]);
  try {
    const effective = effectiveCachePolicy(editor, "fetch", { controller, slowmo: { active: false } })!;
    expect(effective.storing.map((r) => r.id)).toEqual(["hot"]);
    effective.set(structuredClone(table));
    expect(editor.updateMeta).not.toHaveBeenCalled();
    expect(editor.setNodeProps).not.toHaveBeenCalled();
    const next = coalesceRule(effective.table, "hot"),
      options = { merge: "cache:hot" };
    effective.set(next, options);
    expect(editor.updateMeta).toHaveBeenCalledTimes(saved ? 1 : 0);
    expect(editor.setNodeProps).toHaveBeenCalledTimes(saved ? 0 : 1);
    if (saved) {
      expect(editor.updateMeta.mock.calls[0][1]).toBe(options);
      expect(diagram.simulations[0].setup?.props?.cache).toEqual({ latencyMs: 17, cache: next });
      expect(controller.getState().running?.setup?.props?.cache.cache).toEqual(next);
      expect(diagram.nodes[1].props!.cache).toEqual(table);
    } else expect(editor.setNodeProps).toHaveBeenCalledWith("cache", { cache: next }, options);
  } finally {
    controller.dispose();
  }
});

it.each(["slowmo", "draft"])("withholds edits owned by %s", (mode) => {
  const { diagram, editor } = fixture();
  diagram.simulations = [{ id: "run", title: "Saved", traffic: [] }];
  const controller = new LiveController(diagram);
  controller.selectSimulation({ ...diagram.simulations[0], ...(mode === "draft" ? { title: "Draft" } : {}) });
  try {
    const effective = effectiveCachePolicy(editor, "fetch", { controller, slowmo: { active: mode === "slowmo" } })!;
    expect(effective.editable).toBe(false);
    effective.set(coalesceRule(effective.table, ""));
    expect(editor.updateMeta).not.toHaveBeenCalled();
    expect(editor.setNodeProps).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

it("the Live origin submenu shares the confirmed preset and reverses only coalescing", () => {
  const { diagram, editor } = fixture();
  const original = structuredClone(diagram.nodes[1].props!.cache as CacheTable);
  const ctx = {
    target: "edge",
    edgeId: "fetch",
    mode: "live",
    editor,
    selection: { nodeIds: [], edgeIds: [] },
  } as unknown as ActionContext;
  const simulation = builtinActions().find((a) => a.id === "edge.simulation")!;
  const toggle = () => simulation.children!(ctx).find((n) => n.type === "item" && n.id === "edge.coalesce") as MenuItem;
  const stop = vi.spyOn(planningHost, "get").mockReturnValue(null);
  try {
    expect(toggle().label).toBe("One fetch per item");
    toggle().run!();
    expect(diagram.nodes[1].props!.cache).toEqual(coalesceRule(original, ""));
    expect(toggle().label).toBe("Fetch per request");
    toggle().run!();
    expect(diagram.nodes[1].props!.cache).toEqual({ ...original, default: { ...original.default, coalesce: false } });
    (diagram.nodes[1].props!.cache as CacheTable).rules.push({
      id: "second",
      match: {},
      policy: { ttlMs: 9999, keys: 7 },
    });
    expect(toggle()).toBeUndefined();
    const rules = simulation.children!(ctx).find((n) => n.type === "item" && n.id === "edge.cache-rules") as MenuItem;
    rules.run!();
    expect(editor.select).toHaveBeenCalledWith({ nodeIds: ["cache"] });
    expect(editor.openInspector).toHaveBeenCalledWith("cache-add-rule");
  } finally {
    stop.mockRestore();
  }
});

it("non-origin, async, dependency, DLQ and pre-W3 paths have no cache edit", () => {
  const { diagram, editor } = fixture();
  expect(effectiveCachePolicy(editor, "input", null)).toBeUndefined();
  const edge = diagram.edges[1];
  for (const patch of [{ kind: "async" }, { relation: "config" }, { props: { dlq: true } }]) {
    const before = structuredClone(edge);
    Object.assign(edge, patch);
    expect(effectiveCachePolicy(editor, "fetch", null)).toBeUndefined();
    Object.assign(edge, before);
    delete edge.relation;
  }
  diagram.planning!.revision = "p3-w2";
  expect(effectiveCachePolicy(editor, "fetch", null)).toBeUndefined();
});

it("unrelated outgoing Requests cannot edit another routed origin's cache policy", () => {
  const { diagram, editor } = fixture();
  diagram.edges.push({ id: "beacon", from: "cache", to: "origin", kind: "sync" });
  // One unambiguous routed origin remains eligible, despite the unrelated outgoing edge.
  diagram.nodes[1].props!.routeTable = { rules: [], default: { targets: [{ edgeId: "fetch", weight: 1 }] } };
  expect(effectiveCachePolicy(editor, "fetch", null)?.storing).toHaveLength(1);
  expect(effectiveCachePolicy(editor, "beacon", null)).toBeUndefined();
  // With different routed targets, direct connection toggles cannot identify the owning rule.
  diagram.nodes[1].props!.routeTable = {
    rules: [
      {
        id: "beacons",
        match: { path: { kind: "prefix", value: "/events" } },
        targets: [{ edgeId: "beacon", weight: 1 }],
      },
    ],
    default: { targets: [{ edgeId: "fetch", weight: 1 }] },
  };
  expect(effectiveCachePolicy(editor, "beacon", null)).toBeUndefined();
  expect(effectiveCachePolicy(editor, "fetch", null)).toBeUndefined();
});
