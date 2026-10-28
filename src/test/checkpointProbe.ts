import { vi } from "vitest";
import type { CheckpointGraph } from "../sim/engine/checkpoint";

const observer = vi.hoisted(() => ({
  read: undefined as ((graph: CheckpointGraph) => void) | undefined,
  installed: undefined as ((graph: CheckpointGraph) => void) | undefined,
}));

// Observe the facade seam, independent of which copying primitive the engine uses.
vi.mock("../sim/engine/checkpoint", async (importOriginal) => {
  const original = await importOriginal<typeof import("../sim/engine/checkpoint")>();
  return {
    ...original,
    createCheckpoints(...args: Parameters<typeof original.createCheckpoints>) {
      const read = args[3],
        install = args[5];
      args[3] = () => {
        const graph = read();
        observer.read?.(graph);
        return graph;
      };
      args[5] = (...values) => {
        install(...values);
        observer.installed?.(values[0]);
      };
      return original.createCheckpoints(...args);
    },
  };
});

export function watchCheckpoints(limit = 1) {
  const sources: CheckpointGraph[] = [],
    copies: CheckpointGraph[] = [];
  observer.read = (graph) => {
    sources.push(graph);
    if (sources.length === limit) observer.read = undefined;
  };
  observer.installed = (graph) => {
    copies.push(graph);
    if (copies.length === limit) observer.installed = undefined;
  };
  return {
    sources,
    copies,
    stop() {
      observer.read = undefined;
      observer.installed = undefined;
    },
  };
}
