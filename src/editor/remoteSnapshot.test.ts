import { expect, it } from "vitest";
import { toFlow } from "../canvas/convert";
import { remoteTargetRemoved } from "./remoteSnapshot";

it("indexes incoming IDs once for bulk focus preservation", () => {
  for (const size of [128, 1024]) {
    let reads = 0;
    const current = toFlow({
      format: "diagrams/v1",
      title: "Bulk",
      nodes: Array.from({ length: size }, (_, i) => ({ id: `n${i}`, stencil: "service.go", label: "N", x: i, y: 0 })),
      edges: [],
    });
    current.nodes = current.nodes.map((n) => ({ ...n, selected: true }));
    const next = {
      ...current,
      nodes: current.nodes.map(
        (n) =>
          new Proxy(n, {
            get(target, key, receiver) {
              if (key === "id") reads++;
              return Reflect.get(target, key, receiver);
            },
          }),
      ),
    };
    expect(remoteTargetRemoved(current, next, { inspector: true })).toBe(false);
    expect(reads).toBeLessThanOrEqual(size * 2);
    expect(remoteTargetRemoved(current, { ...next, nodes: [] }, { id: "n0" })).toBe(true);
  }
});
