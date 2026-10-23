import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { propertyRuns } from "../../test/fastCheck";
import type { CameraEvent } from "../camera";
import {
  createInteractionController,
  type InteractionEntry,
  type InteractionPort,
  type Resolution,
} from "./controller";
import { createReadoutLayer } from "./readoutLayer";
import type { ReadoutStop } from "./readout";
import type { FocusTarget, InteractionPhase, LiveKeyContext, MenuCloseReason } from "./types";

/** A stand-in element: in the document or not, and able to take focus or not. */
interface El {
  name: string;
  connected: boolean;
  focusable: boolean;
}

/**
 * A deterministic stand-in for the DOM and the frame clock. Nodes may be in the diagram but not yet drawn
 * (React Flow hides them until measured), and anything may leave the document between two frames.
 */
function harness() {
  const frames: (() => void)[] = [];
  const micro: (() => void)[] = [];
  const els = new Map<string, El>();
  const el = (name: string, o: Partial<El> = {}) => {
    const e = { name, connected: true, focusable: true, ...o };
    els.set(name, e);
    return e;
  };
  const canvas = el("canvas");
  const env = {
    active: null as El | null,
    /** Nodes in the diagram, and whether React Flow has drawn them yet. */
    nodes: new Map<string, { drawn: boolean }>(),
    edges: new Set<string>(),
    /** The Inspector: folded, or showing these fields (name → owner). */
    inspector: { open: true, fields: new Map<string, string | undefined>() },
    order: (ids: readonly string[]) => [...ids].sort(),
    version: 0,
    /** One of Live's side panels: open or not, and the fields it lists so far. */
    panel: { open: false, fields: new Set<string>() },
    /** Live readout cards shown ("node:a"). */
    readouts: new Set<string>(),
  };
  /** Focus calls on elements that had left the document (must stay empty). */
  const removedFocus: string[] = [];
  const focused: string[] = [];
  const phases: InteractionPhase[] = [];
  const journal: InteractionEntry[] = [];
  const camera: (CameraEvent | { type: "placing" })[] = [];
  const nodeEl = (id: string) => els.get(`node:${id}`) ?? el(`node:${id}`);
  const resolveNode = (id: string): Resolution => {
    const n = env.nodes.get(id);
    if (!n) return { state: "gone" };
    if (!n.drawn) return { state: "waiting", node: id };
    return { state: "ready", el: nodeEl(id), node: id };
  };
  const port: InteractionPort = {
    active: () => env.active,
    resolve(target: FocusTarget): Resolution {
      switch (target.kind) {
        case "node":
          return resolveNode(target.id);
        case "edge":
          return env.edges.has(target.id)
            ? { state: "ready", el: els.get(`edge:${target.id}`) ?? el(`edge:${target.id}`) }
            : { state: "gone" };
        case "item":
          return env.nodes.get(target.id)?.drawn ? { state: "ready", el: nodeEl(target.id) } : { state: "gone" };
        case "canvas":
          return canvas.connected ? { state: "ready", el: canvas } : { state: "gone" };
        case "selection": {
          const first = env.order(target.nodes.filter((id) => env.nodes.has(id)))[0];
          if (first) return resolveNode(first);
          const e = target.edges.find((x) => env.edges.has(x));
          return e ? { state: "ready", el: els.get(`edge:${e}`) ?? el(`edge:${e}`) } : { state: "gone" };
        }
        case "element": {
          const h = target.handle as El;
          return h.connected ? { state: "ready", el: h } : { state: "gone" };
        }
        case "field": {
          if (!env.inspector.open || !env.inspector.fields.has(target.name)) return { state: "parked" };
          const owner = env.inspector.fields.get(target.name);
          if (target.owner && owner !== target.owner) return { state: "parked" };
          return { state: "ready", el: els.get(`field:${target.name}`) ?? el(`field:${target.name}`) };
        }
        case "paletteSearch":
          return { state: "ready", el: els.get("search") ?? el("search") };
        case "panelOpener": {
          const opener = els.get("panel-opener");
          return opener?.connected ? { state: "ready", el: opener } : { state: "gone" };
        }
        case "readout": {
          const key = `${target.item}:${target.id}`;
          return env.readouts.has(key)
            ? { state: "ready", el: els.get(`readout:${key}`) ?? el(`readout:${key}`) }
            : { state: "gone" };
        }
        case "panelField": {
          // Live's panel: gone when it's closed; parked until it lists the field.
          if (!env.panel.open) return { state: "gone" };
          if (!env.panel.fields.has(target.field)) return { state: "parked" };
          return { state: "ready", el: els.get(target.field) ?? el(target.field) };
        }
      }
    },
    focus(handle) {
      const e = handle as El;
      if (!e.connected) removedFocus.push(e.name);
      if (!e.focusable || !e.connected) return false;
      env.active = e;
      focused.push(e.name);
      return true;
    },
    connected: (h) => (h as El).connected,
    version: () => env.version,
    publish: (p) => phases.push(p),
  };
  const controller = createInteractionController<string>(
    port,
    {
      frame(run) {
        frames.push(run);
        return () => {
          const i = frames.indexOf(run);
          if (i >= 0) frames.splice(i, 1);
        };
      },
      microtask: (run) => void micro.push(run),
    },
    {
      camera: { dispatch: (e) => void camera.push(e), placing: () => void camera.push({ type: "placing" }) },
      journal: (e) => void journal.push(e),
    },
  );
  controller.connect();
  const flushMicro = () => {
    while (micro.length) micro.shift()!();
  };
  const frame = () => {
    const now = frames.splice(0);
    for (const f of now) f();
    flushMicro();
  };
  /** React commits: the layout effects tell the controller, then microtasks run. */
  const commit = () => {
    controller.rendered();
    flushMicro();
  };
  const drain = (max = 20) => {
    for (let i = 0; i < max && (frames.length || micro.length); i++) {
      commit();
      frame();
    }
  };
  const removeNode = (id: string) => {
    env.nodes.delete(id);
    const original = els.get(`node:${id}`);
    if (original) {
      original.connected = false;
      if (env.active === original) env.active = null;
    }
  };
  return {
    controller,
    env,
    el,
    nodeEl,
    removeNode,
    canvas,
    frame,
    commit,
    drain,
    frames,
    removedFocus,
    focused,
    phases,
    journal,
    camera,
  };
}

describe("interaction controller: menus", () => {
  it("Esc in a menu gives focus back to its invoker once React has committed the close (M1)", () => {
    const h = harness();
    const node = h.el("node:a");
    h.env.active = node;
    h.controller.openMenu("context", "menu");
    h.env.active = h.el("menu-list"); // the menu takes focus inside itself
    h.controller.closeMenu("escape");
    h.env.active = null; // its element left the document with it
    expect(h.focused).toEqual([]);
    h.commit();
    expect(h.focused).toEqual(["node:a"]);
    expect(h.controller.phase).toBe("idle");
  });

  it("Esc after the invoker went: the canvas, never the removed element", () => {
    const h = harness();
    const node = h.el("node:a");
    h.env.active = node;
    h.controller.openMenu("context", "menu");
    node.connected = false;
    h.controller.closeMenu("escape");
    h.env.active = null;
    h.drain();
    expect(h.focused).toEqual(["canvas"]);
    expect(h.removedFocus).toEqual([]);
  });

  it("a pick whose action focused something leaves focus there (M2)", () => {
    const h = harness();
    h.env.active = h.el("node:a");
    h.controller.openMenu("context", "menu");
    h.controller.closeMenu("pick");
    h.env.active = h.el("toolbar-button"); // the action focused it
    h.drain();
    expect(h.focused).toEqual([]);
    expect(h.env.active?.name).toBe("toolbar-button");
  });

  it("a pick that left focus lost gives it back to the invoker (M2)", () => {
    const h = harness();
    h.env.active = h.el("canvas-wrap");
    h.controller.openMenu("quickAdd", "menu");
    h.controller.closeMenu("pick");
    h.env.active = null;
    h.drain();
    expect(h.focused).toEqual(["canvas-wrap"]);
  });

  it("a close with no commit following still runs on the next frame", () => {
    const h = harness();
    h.env.active = h.el("node:a");
    h.controller.openMenu("context", "menu");
    h.controller.closeMenu("escape");
    h.env.active = null;
    h.frame();
    expect(h.focused).toEqual(["node:a"]);
  });

  it("tells the camera when a menu opens or closes, only on a change of its kind", () => {
    const h = harness();
    h.controller.openMenu("context", "a");
    h.controller.openMenu("context", "b");
    h.controller.openMenu("connected", "c");
    h.controller.openMenu("quickAdd", "d");
    h.controller.closeMenu("pick");
    h.controller.openMenu("dialog", "shortcuts");
    h.controller.closeMenu("escape");
    expect(h.camera).toEqual([
      { type: "menu.opened", kind: "context" },
      { type: "menu.closed" },
      { type: "menu.opened", kind: "quickAdd" },
      { type: "menu.closed" },
    ]);
  });

  it("a late close from the first menu's listeners leaves the second open", () => {
    const h = harness();
    const first = h.controller.openMenu("context", "a");
    h.controller.openMenu("context", "b");
    h.controller.closeMenu("blur", first);
    expect(h.controller.menu?.payload).toBe("b");
  });
});

describe("interaction controller: keyboard navigation", () => {
  it("focuses the node a step went to on the next frame, and goes on from it before then", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true }).set("b", { drawn: true });
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "a" } });
    expect(h.controller.pendingTarget()).toEqual({ kind: "node", id: "a" });
    expect(h.controller.phase).toBe("focus-pending");
    expect(h.controller.state.roving).toBe("a");
    // A second Tab before the frame: it replaces the first move.
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "b" } });
    h.frame();
    expect(h.focused).toEqual(["node:b"]);
    expect(h.controller.pendingTarget()).toBeUndefined();
    expect(h.controller.phase).toBe("idle");
  });

  it("knows a pending connection too (Ctrl+Alt+] twice before the frame)", () => {
    const h = harness();
    h.env.edges.add("e1");
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "edge", id: "e1" } });
    expect(h.controller.pendingTarget()).toEqual({ kind: "edge", id: "e1" });
    h.frame();
    expect(h.focused).toEqual(["edge:e1"]);
  });

  it("a node removed before its frame never takes focus", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true });
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "a" } });
    h.env.nodes.delete("a");
    h.frame();
    expect(h.focused).toEqual([]);
    expect(h.controller.phase).toBe("idle");
  });
});

describe("interaction controller: Undo", () => {
  it("from the canvas: waits until React Flow draws what it selected, then focuses it (H1)", () => {
    const h = harness();
    h.env.nodes.set("b", { drawn: false }).set("a", { drawn: false });
    let told: boolean | undefined;
    h.controller.dispatch(
      { type: "selection.changed", cause: "undo", selection: { nodes: ["b", "a"], edges: [] }, origin: "canvas" },
      (focused) => (told = focused),
    );
    // Not before the next frame (React draws the restored canvas first), then while it's hidden.
    h.commit();
    h.frame();
    h.frame();
    expect(h.focused).toEqual([]);
    expect(h.controller.phase).toBe("focus-pending");
    expect(h.controller.state.roving).toBe("a");
    h.env.nodes.set("a", { drawn: true });
    h.frame();
    expect(h.focused).toEqual(["node:a"]);
    expect(told).toBe(true);
  });

  it("from the canvas, what it selected has gone: the canvas, not the page", () => {
    const h = harness();
    h.controller.dispatch({
      type: "selection.changed",
      cause: "redo",
      selection: { nodes: ["gone"], edges: [] },
      origin: "canvas",
    });
    h.drain();
    expect(h.focused).toEqual(["canvas"]);
  });

  it("from the toolbar: focus stays, the Tab stop moves (H2)", () => {
    const h = harness();
    h.env.active = h.el("undo-button");
    h.env.nodes.set("a", { drawn: true });
    h.controller.dispatch({
      type: "selection.changed",
      cause: "undo",
      selection: { nodes: ["a"], edges: [] },
      origin: "elsewhere",
    });
    expect(h.controller.phase).toBe("idle");
    h.drain();
    expect(h.focused).toEqual([]);
    expect(h.controller.state.roving).toBe("a");
  });
});

describe("interaction controller: the palette's new node", () => {
  it("waits for a node the diagram hasn't committed yet, and gives up once the diagram changed without it", () => {
    const h = harness();
    h.controller.dispatch({
      type: "selection.changed",
      cause: "palette",
      target: { kind: "node", id: "new" },
      placed: true,
    });
    // Its add commits a few frames late (a busy machine): still pending, not gone.
    h.frame();
    h.frame();
    expect(h.controller.phase).toBe("focus-pending");
    h.env.version++;
    h.env.nodes.set("new", { drawn: false });
    h.frame();
    h.env.nodes.set("new", { drawn: true });
    h.frame();
    expect(h.focused).toEqual(["node:new"]);

    h.controller.dispatch({
      type: "selection.changed",
      cause: "palette",
      target: { kind: "node", id: "x" },
      placed: true,
    });
    h.frame();
    h.env.version++;
    h.frame();
    expect(h.focused).toEqual(["node:new"]);
    expect(h.controller.phase).toBe("idle");
  });
});

describe("interaction controller: Inspector fields", () => {
  it("a request waits, parked, for its item's field; it doesn't hold readiness meanwhile", () => {
    const h = harness();
    h.env.inspector.fields.set("label", "old");
    h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "new" });
    expect(h.focused).toEqual([]);
    expect(h.controller.phase).toBe("idle");
    h.env.inspector.fields.set("label", "new");
    h.commit();
    expect(h.focused).toEqual(["field:label"]);
  });

  it("goes again a frame later if something took focus back (the menu that asked for it, closing)", () => {
    const h = harness();
    h.env.inspector.fields.set("label", undefined);
    h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label" });
    expect(h.focused).toEqual(["field:label"]);
    h.env.active = h.el("node:a");
    h.frame();
    expect(h.focused).toEqual(["field:label", "field:label"]);
  });

  it("not when the person moved focus first (a key or a press in between)", () => {
    const h = harness();
    h.env.inspector.fields.set("label", undefined);
    h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label" });
    h.env.active = h.el("node:a");
    h.controller.input();
    h.frame();
    expect(h.focused).toEqual(["field:label"]);
  });

  it("a request taken elsewhere (claim) never takes focus; each request runs once", () => {
    const h = harness();
    h.env.inspector.fields.set("label", undefined);
    h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label", claim: () => false });
    h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label" });
    h.drain();
    expect(h.focused).toEqual([]);
  });

  it("a folded Inspector holds the request until it opens", () => {
    const h = harness();
    h.env.inspector.open = false;
    h.env.inspector.fields.set("label", undefined);
    h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label" });
    h.drain();
    expect(h.focused).toEqual([]);
    h.env.inspector.open = true;
    h.commit();
    expect(h.focused).toEqual(["field:label"]);
  });
});

describe("interaction controller: selection causes", () => {
  const committed = (h: ReturnType<typeof harness>) =>
    h.journal.map((e) => e.event).filter((e) => e.startsWith("selection"));

  it("one selection.changed per changed commit, with the cause its source declared", () => {
    const h = harness();
    h.controller.selectionCommitted("[]", true);
    h.controller.selecting("click");
    h.controller.selectionCommitted('["a"]', false);
    h.controller.selecting("box");
    h.controller.selectionCommitted('["a","b"]', false);
    // Nothing declared: programmatic (a menu's command, a check's reveal).
    h.controller.selectionCommitted('["c"]', false);
    expect(committed(h)).toEqual([
      "selection.changed:click",
      "selection.changed:box",
      "selection.changed:programmatic",
    ]);
  });

  it("a cause lasts one commit: a commit without a change forgets it", () => {
    const h = harness();
    h.controller.selectionCommitted("[]", true);
    h.controller.selecting("box");
    h.controller.selectionCommitted("[]", true);
    h.controller.selectionCommitted('["a"]', false);
    expect(committed(h)).toEqual(["selection.changed:programmatic"]);
  });

  it("keyboard navigation and history steps decide once, at their own event", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true });
    h.controller.selectionCommitted("[]", true);
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "a" } });
    h.controller.selectionCommitted('["a"]', false);
    expect(committed(h)).toEqual(["selection.changed:keyboard", "selection.committed:keyboard"]);
  });

  it("the camera hears a new, non-empty selection with its cause, and a placement as it's declared", () => {
    const h = harness();
    h.controller.selectionCommitted("[]", true);
    h.controller.placing();
    h.controller.selectionCommitted('["new"]', false);
    h.controller.selecting("click");
    h.controller.selectionCommitted('["b"]', false);
    h.controller.selecting("programmatic");
    h.controller.selectionCommitted("[]", true);
    expect(h.camera).toEqual([
      { type: "placing" },
      { type: "selection.changed", cause: "placement" },
      { type: "selection.changed", cause: "selection" },
    ]);
  });
});

describe("interaction controller: readiness and the journal", () => {
  it("publishes menu-open, focus-pending and idle as they change", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true });
    h.controller.openMenu("context", "m");
    h.controller.closeMenu("escape");
    h.drain();
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "a" } });
    h.frame();
    expect(h.phases).toEqual(["idle", "menu-open", "idle", "focus-pending", "idle"]);
  });

  it("journals each decision and each move's result", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true });
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "a" } });
    h.frame();
    expect(h.journal.map((e) => `${e.event} ${e.command}${e.result ? ` ${e.result}` : ""}`)).toEqual([
      "selection.changed:keyboard focus:node:a@frame",
      "focus.result focus:node:a@frame focused",
      "focus.ran keep",
    ]);
  });

  it("unmounting drops the pending move", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true });
    const stop = h.controller.connect();
    h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "a" } });
    stop();
    h.frame();
    expect(h.focused).toEqual([]);
  });
});

describe("interaction controller: live view", () => {
  const context = (patch: Partial<LiveKeyContext> = {}): LiveKeyContext => ({
    key: "escape",
    repeat: false,
    slowMotion: false,
    recording: false,
    editable: false,
    control: false,
    owner: false,
    selection: false,
    canvasFocus: false,
    trace: false,
    presenting: false,
    path: false,
    alwaysOn: false,
    waiting: false,
    ...patch,
  });

  it("Esc backs out one level per press, each journaled, and never moves focus (L1)", () => {
    const h = harness();
    const levels = [
      h.controller.liveKey(context({ selection: true, trace: true, path: true })),
      h.controller.liveKey(context({ trace: true, path: true })),
      h.controller.liveKey(context({ path: true })),
      h.controller.liveKey(context()),
    ];
    expect(levels).toEqual(["selection", "trace", "path", "exit"]);
    expect(h.journal.map((e) => `${e.event} ${e.command}`)).toEqual([
      "live.key:escape:selection keep",
      "live.key:escape:trace keep",
      "live.key:escape:path keep",
      "live.key:escape:exit keep",
    ]);
    expect(h.focused).toEqual([]);
  });

  it("a live key leaves a pending move pending (a field waiting for its panel)", () => {
    const h = harness();
    h.env.panel.open = true;
    h.controller.dispatch({ type: "panel.field", panel: "capacity-panel", field: "rate" });
    h.controller.liveKey(context({ key: "space" }));
    h.env.panel.fields.add("rate");
    h.commit();
    expect(h.focused).toEqual(["rate"]);
  });

  it("a panel's field waits, parked, until the panel lists it, without holding readiness (L4)", () => {
    const h = harness();
    h.env.panel.open = true;
    h.controller.dispatch({ type: "panel.field", panel: "capacity-panel", field: "rate" });
    expect(h.controller.phase).toBe("idle");
    h.frame();
    expect(h.focused).toEqual([]);
    h.env.panel.fields.add("rate");
    h.commit();
    expect(h.focused).toEqual(["rate"]);
  });

  it("a panel's field whose panel closed meanwhile gives up at the next commit", () => {
    const h = harness();
    h.env.panel.open = true;
    h.controller.dispatch({ type: "panel.field", panel: "capacity-panel", field: "rate" });
    h.env.panel.open = false;
    h.commit();
    h.env.panel.open = true;
    h.env.panel.fields.add("rate");
    h.commit();
    expect(h.focused).toEqual([]);
    expect(h.journal.at(-2)).toMatchObject({ event: "focus.result", result: "gone" });
  });

  it("a Live panel's Esc gives focus back to its opener, else the bar's panel opener (D2)", () => {
    const h = harness();
    const item = h.el("menu-item");
    h.el("panel-opener");
    h.controller.dispatch({ type: "dialog.closed", dialog: "livePanel", opener: item, reason: "escape" });
    item.connected = false;
    h.controller.dispatch({ type: "dialog.closed", dialog: "livePanel", opener: item, reason: "escape" });
    expect(h.focused).toEqual(["menu-item", "panel-opener"]);
    expect(h.journal.map((e) => e.event)).toContain("dialog.closed:livePanel:escape");
  });

  it("the inject dialog gives focus back to its opener, else the node it injects at (D3)", () => {
    const h = harness();
    h.env.nodes.set("inventory", { drawn: true });
    h.controller.dispatch({ type: "dialog.closed", dialog: "inject", opener: null, node: "inventory", reason: "pick" });
    expect(h.focused).toEqual(["node:inventory"]);
  });

  it("a Live popover's Esc gives focus back at once; any other close keeps it (M5, M6)", () => {
    const h = harness();
    const button = h.el("summary");
    const closed = (reason: MenuCloseReason) =>
      h.controller.dispatch({ type: "menu.closed", kind: "live", reason, invoker: button, platform: "other" });
    closed("outside");
    closed("pick");
    expect(h.focused).toEqual([]);
    closed("escape");
    expect(h.focused).toEqual(["summary"]);
    // Not one of the canvas's surfaces: nothing opened over the canvas.
    expect(h.controller.menu).toBeNull();
  });

  it("a trouble callout that had focus gives it to the canvas only if focus was lost (L3)", () => {
    const h = harness();
    h.controller.dispatch({ type: "callout.closed", hadFocus: false });
    h.controller.dispatch({ type: "callout.closed", hadFocus: true });
    expect(h.focused).toEqual(["canvas"]);
    h.env.active = h.el("elsewhere");
    h.controller.dispatch({ type: "callout.closed", hadFocus: true });
    expect(h.focused).toEqual(["canvas"]);
  });
});

// ---------------------------------------------------------------- interleavings, with deterministic frames

type Step =
  | { kind: "open"; invoker: number }
  | { kind: "close"; reason: "escape" | "pick" | "outside" }
  | { kind: "nav"; id: number; edge: boolean }
  | { kind: "undo"; id: number; canvas: boolean }
  | { kind: "field"; owner: number }
  | { kind: "remove"; id: number }
  | { kind: "draw"; id: number }
  | { kind: "blur" }
  | { kind: "input" }
  | { kind: "frame" }
  | { kind: "commit" };

const id = fc.integer({ min: 0, max: 3 });
const step: fc.Arbitrary<Step> = fc.oneof(
  id.map((invoker) => ({ kind: "open" as const, invoker })),
  fc
    .constantFrom("escape" as const, "pick" as const, "outside" as const)
    .map((reason) => ({ kind: "close" as const, reason })),
  fc.tuple(id, fc.boolean()).map(([i, edge]) => ({ kind: "nav" as const, id: i, edge })),
  fc.tuple(id, fc.boolean()).map(([i, canvas]) => ({ kind: "undo" as const, id: i, canvas })),
  id.map((owner) => ({ kind: "field" as const, owner })),
  id.map((i) => ({ kind: "remove" as const, id: i })),
  id.map((i) => ({ kind: "draw" as const, id: i })),
  fc.constant({ kind: "blur" as const }),
  fc.constant({ kind: "input" as const }),
  fc.constant({ kind: "frame" as const }),
  fc.constant({ kind: "commit" as const }),
);

function replay(h: ReturnType<typeof harness>, s: Step) {
  switch (s.kind) {
    case "open":
      if (!h.env.nodes.has(`n${s.invoker}`)) break;
      h.env.active = h.nodeEl(`n${s.invoker}`);
      h.controller.openMenu("context", "m");
      break;
    case "close":
      h.controller.closeMenu(s.reason);
      if (h.env.active && !h.env.active.name.startsWith("node:")) h.env.active = null;
      break;
    case "nav":
      h.controller.dispatch({
        type: "selection.changed",
        cause: "keyboard",
        target: s.edge ? { kind: "edge", id: `e${s.id}` } : { kind: "node", id: `n${s.id}` },
      });
      break;
    case "undo":
      h.controller.dispatch({
        type: "selection.changed",
        cause: "undo",
        selection: { nodes: [`n${s.id}`], edges: [] },
        origin: s.canvas ? "canvas" : "elsewhere",
      });
      break;
    case "field":
      h.env.inspector.fields.set("label", `n${s.owner}`);
      h.controller.dispatch({
        type: "inspector.field",
        seq: h.controller.state.fieldSeq + 1,
        name: "label",
        owner: `n${s.owner}`,
      });
      break;
    case "remove": {
      h.removeNode(`n${s.id}`);
      break;
    }
    case "draw":
      if (h.env.nodes.has(`n${s.id}`)) h.env.nodes.set(`n${s.id}`, { drawn: true });
      break;
    case "blur":
      h.env.active = null;
      break;
    case "input":
      h.controller.input();
      break;
    case "frame":
      h.frame();
      break;
    case "commit":
      h.commit();
      break;
  }
}

describe("interaction controller: arbitrary interleavings", () => {
  it("never focuses a removed element, keeps at most one move pending, and drains to idle", () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 50 }), (steps) => {
        const h = harness();
        for (let i = 0; i < 4; i++) {
          h.env.nodes.set(`n${i}`, { drawn: i % 2 === 0 });
          h.env.edges.add(`e${i}`);
        }
        for (const s of steps) {
          replay(h, s);
          expect(h.removedFocus).toEqual([]);
          expect(h.frames.length).toBeLessThanOrEqual(2);
        }
        // Close what's open, draw what's left: every move has run or given up.
        h.controller.closeMenu("unmount");
        for (const [n] of h.env.nodes) h.env.nodes.set(n, { drawn: true });
        h.drain(40);
        expect(h.removedFocus).toEqual([]);
        expect(h.controller.phase).toBe("idle");
        expect(h.frames.length).toBe(0);
      }),
      { numRuns: propertyRuns(300) },
    );
  });

  it("Esc restores its invoker unless generated later navigation supersedes it", () => {
    const afterStep = fc.oneof(
      id.map((i) => ({ kind: "nav" as const, id: i, edge: false })),
      fc.constant({ kind: "frame" as const }),
      fc.constant({ kind: "commit" as const }),
      fc.constant({ kind: "input" as const }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), fc.array(afterStep, { maxLength: 30 }), (before, after) => {
        const h = harness();
        for (let i = 0; i < 4; i++) h.env.nodes.set(`n${i}`, { drawn: true });
        for (const s of before) replay(h, s);
        h.controller.closeMenu("unmount");
        h.drain();
        // A connected invoker and destinations, after all the preceding interactions have settled.
        for (let i = 0; i < 4; i++) {
          h.env.nodes.set(`n${i}`, { drawn: true });
          h.nodeEl(`n${i}`).connected = true;
        }
        const invoker = h.nodeEl("n1");
        h.env.active = invoker;
        h.controller.openMenu("context", "m");
        h.env.active = h.el("menu");
        h.controller.closeMenu("escape");
        h.env.active = null;
        const mark = h.journal.length;
        for (const s of after) replay(h, s);
        h.drain();
        const lastNavigation = [...after].reverse().find((s) => s.kind === "nav");
        expect(h.env.active).toBe(lastNavigation ? h.nodeEl(`n${lastNavigation.id}`) : invoker);
        // Navigation before the close commits replaces restoration entirely.
        const firstNav = after.findIndex((s) => s.kind === "nav");
        if (firstNav >= 0 && after.slice(0, firstNav).every((s) => s.kind === "input"))
          expect(h.journal.slice(mark).find((e) => e.event === "focus.result")?.result).toBe("superseded");
        expect(h.removedFocus).toEqual([]);
        expect(h.controller.phase).toBe("idle");
      }),
      { numRuns: propertyRuns(100) },
    );
  });
});

it("removing a captured menu invoker falls back to canvas through sequence replay", () => {
  const h = harness();
  h.env.nodes.set("n1", { drawn: true });
  replay(h, { kind: "open", invoker: 1 });
  const original = h.env.active!;
  replay(h, { kind: "remove", id: 1 });
  expect(original.connected).toBe(false);
  expect(h.env.active).toBeNull();
  replay(h, { kind: "close", reason: "escape" });
  replay(h, { kind: "commit" });
  expect(h.focused).toEqual(["canvas"]);
  expect(h.removedFocus).toEqual([]);
});

it("later navigation supersedes pending Escape restoration", () => {
  const h = harness();
  h.env.nodes.set("n1", { drawn: true }).set("n2", { drawn: true });
  replay(h, { kind: "open", invoker: 1 });
  replay(h, { kind: "close", reason: "escape" });
  replay(h, { kind: "nav", id: 2, edge: false });
  h.commit();
  h.drain();
  expect(h.focused).toEqual(["node:n2"]);
});

it("an unrelated peer update preserves navigation before its focus frame", () => {
  const h = harness();
  h.env.nodes.set("a", { drawn: true }).set("b", { drawn: true }).set("c", { drawn: true });
  h.env.active = h.nodeEl("a");
  h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "b" } });
  h.controller.dispatch({ type: "document.replaced", active: h.env.active });
  expect(h.controller.pendingTarget()).toEqual({ kind: "node", id: "b" });
  h.frame();
  expect(h.env.active).toBe(h.nodeEl("b"));
  h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "c" } });
  h.frame();
  expect(h.focused).toEqual(["node:b", "node:c"]);
});

it("an unrelated peer update preserves a parked Inspector request", () => {
  const h = harness();
  h.env.active = h.nodeEl("a");
  h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "b" });
  h.controller.dispatch({ type: "document.replaced", active: h.env.active });
  h.env.inspector.fields.set("label", "b");
  h.commit();
  h.drain();
  expect(h.focused).toEqual(["field:label"]);
});

it("a newer peer recovery follows the latest focused element", () => {
  const h = harness();
  h.env.nodes.set("a", { drawn: true }).set("b", { drawn: true });
  h.env.active = h.nodeEl("a");
  h.controller.dispatch({ type: "document.replaced", active: h.env.active });
  // A click moves focus before the first recovery frame, then a peer removes that new target.
  h.env.active = h.nodeEl("b");
  h.controller.dispatch({ type: "document.replaced", active: h.env.active });
  h.removeNode("b");
  h.frame();
  expect(h.focused).toEqual(["canvas"]);
  expect(h.controller.phase).toBe("idle");
});

it("peer removal recovers after an Inspector retry loses its owner", () => {
  const h = harness();
  h.env.inspector.fields.set("label", "a");
  h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "a" });
  const original = h.env.active!;
  let recovered: boolean | undefined;
  h.controller.dispatch({ type: "document.replaced", active: original }, (ok) => (recovered = ok));
  h.env.inspector.fields.delete("label");
  original.connected = false;
  h.env.active = null;
  h.frame();
  expect(h.focused).toEqual(["field:label", "canvas"]);
  expect(recovered).toBe(true);
  expect(h.frames).toHaveLength(0);
  expect(h.controller.phase).toBe("idle");
});

it("peer removal recovers without consuming a parked request for another surviving field", () => {
  const h = harness();
  const original = h.nodeEl("a");
  h.env.active = original;
  h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "b" });
  const pending = h.controller.state.pending;
  h.controller.dispatch({ type: "document.replaced", active: original });
  original.connected = false;
  h.env.active = null;
  h.frame();
  expect(h.focused).toEqual(["canvas"]);
  expect(h.controller.state.pending).toBe(pending);
  h.env.inspector.fields.set("label", "b");
  h.commit();
  h.drain();
  expect(h.focused).toEqual(["canvas", "field:label"]);
  expect(h.controller.phase).toBe("idle");
});

it("a later navigation supersedes conditional recovery beside an older user move", () => {
  const h = harness();
  h.env.nodes.set("a", { drawn: true }).set("b", { drawn: true }).set("c", { drawn: true });
  const original = h.nodeEl("a");
  h.env.active = original;
  h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "b" } });
  h.controller.dispatch({ type: "document.replaced", active: original });
  h.removeNode("a");
  h.controller.dispatch({ type: "selection.changed", cause: "keyboard", target: { kind: "node", id: "c" } });
  h.drain();
  expect(h.focused).toEqual(["node:c"]);
});

it("unmount cancels conditional recovery beside a parked request", () => {
  const h = harness();
  const stop = h.controller.connect();
  h.controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "b" });
  h.controller.dispatch({ type: "document.replaced", active: h.nodeEl("a") });
  stop();
  expect(h.frames).toHaveLength(0);
  h.frame();
  expect(h.focused).toEqual([]);
});

/** Live's readout layer on the harness's controller, with the harness's cards for its DOM. */
function withReadouts(h: ReturnType<typeof harness>, stop: ReadoutStop | null = null) {
  const layer = createReadoutLayer(h.controller, {
    stop: () => stop,
    shown: (t) => h.env.readouts.has(`${t.kind}:${t.id}`),
    holds: (t) => h.env.active?.name === `readout:${t.kind}:${t.id}`,
  });
  h.controller.attachReadouts(layer);
  return layer;
}

describe("pinned Live readouts", () => {
  it("dismissing a hovered readout leaves keyboard focus where it was", () => {
    const h = harness();
    const r = withReadouts(h);
    h.env.nodes.set("a", { drawn: true });
    r.point({ kind: "node", id: "a" });
    r.close("escape");
    expect(r.get()).toBeNull();
    expect(h.focused).toEqual([]);
    r.point({ kind: "node", id: "a" });
    expect(r.get()).toBeNull();
  });
  it("Esc returns focus to the originating item; opening a menu replaces the readout", () => {
    const h = harness();
    const r = withReadouts(h);
    h.env.nodes.set("a", { drawn: true });
    r.pin({ kind: "node", id: "a" });
    r.close("escape");
    expect(h.focused).toEqual(["node:a"]);
    expect(r.get()).toBeNull();
    r.point({ kind: "node", id: "a" });
    expect(r.get()).toBeNull();
    r.pin({ kind: "edge", id: "call" });
    h.controller.openMenu("context", "menu");
    expect(r.get()).toBeNull();
    expect(h.controller.menu?.kind).toBe("context");
    r.point({ kind: "node", id: "a" });
    expect(r.get()).toBeNull();
  });
  it("Esc on an unpinned summary Tab reached gives focus back to its item; a hovered one leaves focus alone", () => {
    const h = harness();
    const r = withReadouts(h);
    h.env.nodes.set("a", { drawn: true });
    h.env.readouts.add("node:a");
    r.point({ kind: "node", id: "a" });
    expect(r.enter({ kind: "node", id: "a" })).toBe(true);
    expect(h.focused).toEqual(["readout:node:a"]);
    r.close("escape");
    expect(h.focused).toEqual(["readout:node:a", "node:a"]);
    expect(r.get()).toBeNull();
    // Hovered while focus is elsewhere (the Live bar): Esc closes it and focus stays put.
    const bar = h.el("live-play");
    h.env.active = bar;
    r.point({ kind: "node", id: "b" });
    r.close("escape");
    expect(h.focused).toEqual(["readout:node:a", "node:a"]);
    expect(h.env.active).toBe(bar);
  });
  it("an outside press leaves the new focus alone and allows a later hover", () => {
    const h = harness();
    const r = withReadouts(h);
    r.pin({ kind: "node", id: "a" });
    r.close("outside");
    expect(h.focused).toEqual([]);
    r.point({ kind: "node", id: "a" });
    expect(r.get()).toEqual({ kind: "node", id: "a", pinned: false });
  });
});

describe("Live readouts beside the canvas's snapshot", () => {
  it("hovering never changes the canvas snapshot; readout subscribers hear only a different card", () => {
    const h = harness();
    const r = withReadouts(h);
    const before = h.controller.getSnapshot();
    let core = 0,
      reads = 0;
    h.controller.subscribe(() => core++);
    r.subscribe(() => reads++);
    r.point({ kind: "node", id: "a" });
    r.point({ kind: "node", id: "a" });
    r.point({ kind: "edge", id: "e" });
    r.pin({ kind: "edge", id: "e" });
    r.point({ kind: "node", id: "a" });
    r.point(null);
    expect(reads).toBe(3);
    expect(core).toBe(0);
    expect(h.controller.getSnapshot()).toBe(before);
    expect(r.get()).toEqual({ kind: "edge", id: "e", pinned: true });
  });

  it("is the controller's while attached, and only the layer that attached detaches", () => {
    const h = harness();
    const first = createReadoutLayer(h.controller);
    const second = createReadoutLayer(h.controller);
    const detachFirst = h.controller.attachReadouts(first);
    const detachSecond = h.controller.attachReadouts(second);
    detachFirst();
    expect(h.controller.readouts).toBe(second);
    detachSecond();
    expect(h.controller.readouts).toBeNull();
  });

  it("Tab into a shown readout focuses its card now", () => {
    const h = harness();
    const r = withReadouts(h);
    expect(r.enter({ kind: "edge", id: "call" })).toBe(false);
    h.env.readouts.add("edge:call");
    expect(r.enter({ kind: "edge", id: "call" })).toBe(true);
    expect(h.focused).toEqual(["readout:edge:call"]);
    expect(h.controller.phase).toBe("idle");
  });

  it("Shift+Tab opens the previous node's readout (releasing a pin) and focuses it once drawn", () => {
    const h = harness();
    const r = withReadouts(h);
    h.env.nodes.set("a", { drawn: true });
    r.pin({ kind: "node", id: "b" });
    r.retrace({ kind: "node", id: "a" });
    expect(r.get()).toEqual({ kind: "node", id: "a", pinned: false });
    expect(h.focused).toEqual([]);
    h.env.readouts.add("node:a");
    h.commit();
    expect(h.focused).toEqual(["readout:node:a"]);
    expect(h.controller.phase).toBe("idle");
  });

  it("a readout that never draws leaves focus on its node; with no card open, Shift+Tab opens nothing", () => {
    const h = harness();
    const r = withReadouts(h);
    h.env.nodes.set("a", { drawn: true });
    r.retrace({ kind: "node", id: "a" });
    expect(r.get()).toBeNull();
    expect(h.controller.phase).toBe("idle");
    r.point({ kind: "node", id: "b" });
    r.retrace({ kind: "node", id: "a" });
    h.drain();
    expect(h.focused).toEqual(["node:a"]);
    expect(h.controller.phase).toBe("idle");
  });

  const nav = (next: string | null) => {
    const went: string[] = [];
    return {
      went,
      nav: {
        has: (t: { id: string }) => t.id !== "elsewhere",
        go: (t: { kind: string; id: string }) => {
          went.push(`${t.kind}:${t.id}`);
          return true;
        },
        after: () => next,
      },
    };
  };
  const stop = (pinned: boolean, card: boolean, last: boolean, id = "a"): ReadoutStop => ({
    target: { kind: "node", id },
    pinned,
    card,
    last,
  });

  it("Tab from a card goes on to the next node, releasing a pin; Shift+Tab returns to its item", () => {
    const h = harness();
    const r = withReadouts(h, stop(true, false, true));
    r.pin({ kind: "node", id: "a" });
    const forward = nav("b");
    expect(r.tab(null, false, forward.nav)).toBe(true);
    expect(forward.went).toEqual(["node:b"]);
    expect(r.get()).toEqual({ kind: "node", id: "a", pinned: false });
    const back = nav("b");
    expect(withReadouts(h, stop(false, true, false)).tab(null, true, back.nav)).toBe(true);
    expect(back.went).toEqual(["node:a"]);
  });

  it("leaves Tab to the browser within a pinned card, outside any card, and for another canvas's card", () => {
    const h = harness();
    expect(withReadouts(h, stop(true, false, false)).tab(null, false, nav("b").nav)).toBe(false);
    expect(withReadouts(h, null).tab(null, false, nav("b").nav)).toBeUndefined();
    const other = nav("b");
    expect(withReadouts(h, stop(false, true, false, "elsewhere")).tab(null, false, other.nav)).toBe(false);
    expect(other.went).toEqual([]);
  });

  it("Tab past the last node focuses the card's item now, for the browser's Tab to go on", () => {
    const h = harness();
    h.env.nodes.set("a", { drawn: true });
    const last = nav(null);
    expect(withReadouts(h, stop(false, true, false)).tab(null, false, last.nav)).toBe(false);
    expect(last.went).toEqual([]);
    expect(h.focused).toEqual(["node:a"]);
  });
});
