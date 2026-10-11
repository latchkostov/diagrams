// Live decorations on the real canvas DOM, applied imperatively at the UI clock (~8 Hz): status,
// heat and dimming on node wrappers, active / idle on edges. Only `data-live-*` attributes are
// written, which React Flow never touches, so a node or edge re-render doesn't wipe them. Styling
// lives in live.css.

import type { SimSnapshot } from "../sim/types";
import { heatOf } from "./format";

export interface DecorationInput {
  snapshot: SimSnapshot;
  /** When set, everything outside these nodes / edges is dimmed (narration focus, path trace). */
  spotlight: { nodes: ReadonlySet<string>; edges: ReadonlySet<string>; kind: "focus" | "trace" } | null;
}

const RISE_WINDOW = 8; // samples (~1 s at 8 Hz)

export class Decorator {
  private applied = new Map<Element, string>();
  private history = new Map<string, number[]>();

  constructor(private root: HTMLElement) {}

  apply({ snapshot, spotlight }: DecorationInput): void {
    const root = this.root;
    setAttr(root, "data-live", "on");
    setAttr(root, "data-live-spotlight", spotlight?.kind ?? null);
    const seen = new Set<Element>();

    for (const el of root.querySelectorAll<HTMLElement>(".react-flow__node-diagram[data-id]")) {
      const id = el.dataset.id!;
      const n = snapshot.nodes[id];
      if (!n) continue;
      const hist = this.history.get(id) ?? [];
      hist.push(n.backlog);
      if (hist.length > RISE_WINDOW) hist.shift();
      this.history.set(id, hist);
      const rising = n.backlog > 0 && hist.length > 1 && n.backlog > hist[0];
      const heat = n.backlog > 0 ? Math.max(1, Math.ceil(heatOf(n.backlog) * 3)) : 0;
      const dim = spotlight ? !spotlight.nodes.has(id) : false;
      const key = `${n.status}|${heat}|${rising}|${dim}`;
      seen.add(el);
      if (this.applied.get(el) === key) continue;
      this.applied.set(el, key);
      setAttr(el, "data-live-status", n.status);
      setAttr(el, "data-live-heat", heat ? String(heat) : null);
      setAttr(el, "data-live-rising", rising ? "1" : null);
      setAttr(el, "data-live-dim", dim ? "1" : null);
    }

    for (const el of root.querySelectorAll<SVGElement>(".react-flow__edge[data-id]")) {
      const id = el.getAttribute("data-id")!;
      const e = snapshot.edges[id];
      const active = !!e && e.active > 0;
      const dim = spotlight ? !spotlight.edges.has(id) : false;
      const lit = spotlight?.kind === "trace" && spotlight.edges.has(id);
      const key = `${active}|${dim}|${lit}`;
      seen.add(el);
      if (this.applied.get(el) === key) continue;
      this.applied.set(el, key);
      setAttr(el, "data-live-edge", active ? "active" : "idle");
      setAttr(el, "data-live-dim", dim ? "1" : null);
      setAttr(el, "data-live-trace", lit ? "1" : null);
    }

    // Elements that went away (deleted, remounted) shouldn't keep a stale cache entry.
    for (const el of this.applied.keys()) if (!seen.has(el)) this.applied.delete(el);
  }

  /** Remove every live attribute (leaving live mode). */
  clear(): void {
    const root = this.root;
    for (const a of ["data-live", "data-live-spotlight"]) root.removeAttribute(a);
    for (const el of root.querySelectorAll(
      "[data-live-status],[data-live-edge],[data-live-dim],[data-live-heat],[data-live-trace],[data-live-rising]",
    )) {
      for (const a of [
        "data-live-status",
        "data-live-edge",
        "data-live-dim",
        "data-live-heat",
        "data-live-trace",
        "data-live-rising",
      ])
        el.removeAttribute(a);
    }
    this.applied.clear();
    this.history.clear();
  }
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
