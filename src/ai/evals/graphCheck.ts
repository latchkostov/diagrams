import type { DiagramFile, DiagramNode } from "../../model/types";
import { getStencil } from "../../stencils/registry";
import type { ExpectedGraph } from "./corpus";

// Does a diagram contain an expected graph? Shared by the eval corpus (exact labels) and the on-device
// evals (a model picks its own labels): expected nodes are matched to real ones by stencil (and label
// when asked), one to one, and every expected connection must join the matched nodes in its direction
// (and only in that direction, unless both are expected).

export interface GraphCheckOptions {
  /** "exact": labels must match too; "any": only stencils (a model names things its own way). */
  labels?: "exact" | "any";
}

/** Why `diagram` doesn't contain `expected`, or null when it does. */
export function checkGraph(
  diagram: DiagramFile,
  expected: ExpectedGraph,
  { labels = "any" }: GraphCheckOptions = {},
): string | null {
  // With labels "any" (a model's own words), a node's `accept` list counts too.
  const accepts = (want: ExpectedGraph["nodes"][number], stencil: string) =>
    stencil === want.stencil ||
    (labels === "any" &&
      !!want.accept?.some((a) =>
        a.startsWith("role:")
          ? getStencil(stencil).simRole === a.slice(5)
          : a.startsWith("category:")
            ? getStencil(stencil).category === a.slice(9)
            : a === stencil,
      ));
  const fits = (want: ExpectedGraph["nodes"][number], n: DiagramNode) =>
    accepts(want, n.stencil) && (labels === "any" || n.label === want.label);
  const candidates = expected.nodes.map((want) => diagram.nodes.filter((n) => fits(want, n)));
  const missing = expected.nodes.filter((_, i) => !candidates[i].length);
  if (missing.length)
    return `missing ${missing
      .map((n) =>
        labels === "exact"
          ? `${n.label} (${n.stencil})`
          : n.accept?.length
            ? `${n.stencil} (or ${n.accept.map((a) => a.replace(/^role:/, "any ").replace(/^category:/, "any ")).join(", ")})`
            : n.stencil,
      )
      .join(", ")}`;

  const index = new Map(expected.nodes.map((n, i) => [n.label, i]));
  const edges = expected.edges.map(([from, to]) => {
    const f = index.get(from);
    const t = index.get(to);
    if (f === undefined || t === undefined) throw new Error(`expected edge ${from} -> ${to} names an unknown node`);
    return [f, t] as const;
  });
  const has = new Set(diagram.edges.map((e) => `${e.from}\u0000${e.to}`));
  const joined = (a: string, b: string) => has.has(`${a}\u0000${b}`);

  // An expected one-way connection drawn both ways is reversed too (unless both ways are expected).
  const expectedPair = new Set(edges.map(([f, t]) => `${f}\u0000${t}`));
  const backwards = (p: string[]) => edges.find(([f, t]) => !expectedPair.has(`${t}\u0000${f}`) && joined(p[t], p[f]));
  // The assignment that satisfies the most expected connections (graphs here are small: backtracking).
  // Among those with all of them, one without a connection drawn backwards as well, if any.
  let best: { pick: string[]; score: number } = { pick: [], score: -1 };
  const pick: string[] = [];
  const used = new Set<string>();
  const score = () => edges.filter(([f, t]) => joined(pick[f], pick[t])).length * 2 + (backwards(pick) ? 0 : 1);
  const walk = (i: number): boolean => {
    if (i === expected.nodes.length) {
      const s = score();
      if (s > best.score) best = { pick: [...pick], score: s };
      return s === edges.length * 2 + 1;
    }
    for (const n of candidates[i]) {
      if (used.has(n.id)) continue;
      used.add(n.id);
      pick[i] = n.id;
      if (walk(i + 1)) return true;
      used.delete(n.id);
    }
    return false;
  };
  walk(0);
  if (best.score < 0) return "not enough distinct nodes for the expected ones";
  if (best.score === edges.length * 2 + 1) return null;
  const name = (i: number) => (labels === "exact" ? expected.nodes[i].label : expected.nodes[i].stencil);
  const missed = edges.find(([a, b]) => !joined(best.pick[a], best.pick[b]));
  if (!missed) {
    const [f, t] = backwards(best.pick)!;
    return `reversed connection: ${name(t)} -> ${name(f)} drawn as well as ${name(f)} -> ${name(t)}`;
  }
  const [f, t] = missed;
  return joined(best.pick[t], best.pick[f])
    ? `reversed connection: ${name(t)} -> ${name(f)} instead of ${name(f)} -> ${name(t)}`
    : `no connection ${name(f)} -> ${name(t)}`;
}
