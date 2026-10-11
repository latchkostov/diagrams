import type { DiagramNode, SimRole } from "../model/types";
import { resolveProps } from "./defaults";
import type { InjectOptions, SimEngine } from "./types";
import { resolveScale } from "./units";

/** Manual real counts share credit by resolved type, independently of traffic multipliers. */
export function createRealCountInjector(
  engine: SimEngine,
  nodeById: (id: string) => DiagramNode | undefined,
  roleOf: (stencil: string) => SimRole,
) {
  let credits = new Map<string, number>();
  return {
    inject(nodeId: string, count: number, scale: number, options: InjectOptions = {}) {
      const node = nodeById(nodeId);
      if (!node || !Number.isFinite(count) || count <= 0) return;
      const type =
        options.type ?? resolveProps(roleOf(node.stencil), node.label, engine.effectiveProps(nodeId)).messageType;
      const key = JSON.stringify([nodeId, type]);
      const credit = (credits.get(key) ?? 0) + count / resolveScale(scale);
      const samples = Math.floor(credit + 1e-9);
      credits.set(key, credit - samples);
      if (samples > 0) engine.inject(nodeId, samples, { ...options, type });
    },
    clear() {
      credits.clear();
    },
    checkpoint: () => new Map(credits),
    restore(saved: ReadonlyMap<string, number>) {
      credits = new Map(saved);
    },
  };
}
