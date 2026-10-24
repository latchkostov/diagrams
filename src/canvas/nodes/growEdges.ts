import type { Edge } from "@xyflow/react";

/** Selection-only edge changes do not move labels; repeated store notifications reuse the comparison. */
export function createGrowEdgesEqual() {
  let previous: Edge[] | undefined;
  let incoming: Edge[] | undefined;
  let equal = false;
  return (a: Edge[], b: Edge[]) => {
    if (a === b) return true;
    if (a === previous && b === incoming) return equal;
    previous = a;
    incoming = b;
    equal =
      a.length === b.length &&
      a.every(
        (e, i) =>
          e.id === b[i].id &&
          e.source === b[i].source &&
          e.target === b[i].target &&
          e.data === b[i].data &&
          e.hidden === b[i].hidden,
      );
    return equal;
  };
}
