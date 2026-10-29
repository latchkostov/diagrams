import type { ReactFlowState } from "@xyflow/react";
import type { DiagramFlowEdge, FlowNode } from "./types";

type Inputs = readonly unknown[];
type Reading = { inputs: Inputs; value: unknown };
type Counts = { readiness: number; frame: number; identity: number; reads: number; animations: number };
const scenes = new WeakMap<HTMLElement, ReturnType<typeof createPreparation>>();

/** Canvas-local measurements. Callers supply every input that can change the measured ink;
 * position-only edits reuse dimensions, while fonts, variants, wrapping and scale refit it. */
export function geometryPreparation(root: HTMLElement) {
  let scene = scenes.get(root);
  if (!scene) {
    scene = createPreparation(root);
    scenes.set(root, scene);
  }
  return scene;
}

function createPreparation(root: HTMLElement) {
  let readings = new WeakMap<Element, Map<string, Reading[]>>();
  const named = new Map<string, Map<string, Reading[]>>();
  let inputs: Inputs = [];
  let revision = 0;
  let source: ReactFlowState<FlowNode, DiagramFlowEdge> | undefined;
  const counts: Counts | undefined =
    import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
      ? { readiness: 0, frame: 0, identity: 0, reads: 0, animations: 0 }
      : undefined;
  const same = (a: Inputs, b: Inputs) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const count = (kind: keyof Counts) => {
    if (counts) counts[kind]++;
  };
  const report = () => {
    if (counts) root.dataset.geometryWork = JSON.stringify({ revision, ...counts });
  };
  const advance = (next: Inputs) => {
    if (!same(inputs, next)) {
      inputs = next;
      revision++;
    }
    return revision;
  };
  return {
    count,
    report,
    get counts() {
      return { revision, ...counts };
    },
    revision: advance,
    sync(state: ReactFlowState<FlowNode, DiagramFlowEdge>) {
      if (source === state) return revision;
      source = state;
      const next: unknown[] = [
        state.width,
        state.height,
        ...state.transform,
        state.connection?.fromNode?.id,
        state.connection?.toNode?.id,
      ];
      for (const node of state.nodes) {
        const internal = state.nodeLookup?.get(node.id);
        const at = internal?.internals?.positionAbsolute ?? node.position;
        next.push(
          node.id,
          node.type,
          node.data,
          node.selected,
          node.hidden,
          node.className,
          at.x,
          at.y,
          internal?.measured?.width,
          internal?.measured?.height,
        );
      }
      for (const edge of state.edges ?? [])
        next.push(edge.id, edge.source, edge.target, edge.data, edge.hidden, edge.selected);
      const ids = new Set(state.nodes.map((node) => node.id));
      for (const id of named.keys()) if (!ids.has(id)) named.delete(id);
      return advance(next);
    },
    clear() {
      readings = new WeakMap();
      named.clear();
      revision++;
    },
    forget(el: Element | string) {
      if (typeof el === "string") named.delete(el);
      else readings.delete(el);
    },
    measure<T>(el: Element | string, kind: string, key: Inputs, read: () => T): T {
      let byKind = typeof el === "string" ? named.get(el) : readings.get(el);
      if (!byKind) {
        byKind = new Map();
        if (typeof el === "string") named.set(el, byKind);
        else readings.set(el, byKind);
      }
      const previous = byKind.get(kind) ?? [];
      const old = previous.find((reading) => same(reading.inputs, key));
      if (old) return old.value as T;
      count("reads");
      const value = read();
      // Retain the natural/Overview/Focus appearances across renderer remounts,
      // without accumulating every intermediate zoom or historical document value.
      byKind.set(kind, [{ inputs: key, value }, ...previous].slice(0, 3));
      return value;
    },
  };
}
