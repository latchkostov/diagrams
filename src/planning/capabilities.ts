import type { DiagramFile, DiagramNode } from "../model/types";
import type { BrokerSpec } from "../model/brokers";
import { profileOf } from "../stencils/profiles";
import { stencilRole } from "../stencils/roles";
import { compileTopology, brokerRole, type CompiledTopology } from "../sim/topology";
import { resolveProps, type ResolvedProps } from "../sim/defaults";

export interface Capability {
  kind: "consumes" | "publishes" | "calls";
  edge: string;
  peer: string;
  group?: string;
  broker?: BrokerSpec;
  filter?: string[];
  emits?: string;
  share?: number;
  retry?: "requeue" | "inplace";
  retryBackoffMs?: number;
}
const BROKER_FAMILIES = new Set(["log", "queue", "pubsub"]);
const broker = (node: DiagramNode) => {
  const family = profileOf(node.stencil)?.family;
  return family ? BROKER_FAMILIES.has(family) : brokerRole(stencilRole(node.stencil));
};

/** Derived on every graph change. Dependencies, dead-letter routes and deny rules grant no capability. */
export function resolveCapabilities(
  d: DiagramFile,
  topology: CompiledTopology = compileTopology(d),
  only?: DiagramNode,
  resolved?: ResolvedProps,
): Record<string, Capability[]> {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const propsById = new Map<string, ResolvedProps>();
  if (only && resolved) propsById.set(only.id, resolved);
  const propsOf = (node: DiagramNode) => {
    let props = propsById.get(node.id);
    if (!props) {
      props = resolveProps(stencilRole(node.stencil), node.label, node.props ?? {}, node.stencil, d.planning);
      propsById.set(node.id, props);
    }
    return props;
  };
  const out: Record<string, Capability[]> = Object.create(null);
  const add = (id: string, row: Capability) => (out[id] ??= []).push(row);
  for (const e of topology.edges) {
    if (e.dlq || e.deny) continue;
    const source = nodes.get(e.from)!;
    const target = nodes.get(e.to)!;
    // Gateways route uniformly; brokers allocate readers. Neither executes the fan-out share setting.
    const share = !broker(source) && stencilRole(source.stencil) !== "gateway" ? e.share : undefined;
    if ((!only || e.to === only.id) && !e.sync && broker(source) && stencilRole(target.stencil) === "processor") {
      const props = propsOf(target);
      add(e.to, {
        kind: "consumes",
        edge: e.id,
        peer: e.from,
        ...(stencilRole(source.stencil) !== "queue" ? { group: e.groupName, broker: propsOf(source).broker } : {}),
        ...(e.filter ? { filter: e.filter } : {}),
        retry: props.retry,
        retryBackoffMs: props.retryBackoffMs,
      });
    }
    if (!only || e.from === only.id) {
      if (e.sync)
        add(e.from, {
          kind: "calls",
          edge: e.id,
          peer: e.to,
          ...(e.filter ? { filter: e.filter } : {}),
          ...(share !== undefined ? { share } : {}),
        });
      else if (broker(target))
        add(e.from, {
          kind: "publishes",
          edge: e.id,
          peer: e.to,
          ...(e.emits ? { emits: e.emits } : {}),
          ...(e.filter ? { filter: e.filter } : {}),
          ...(share !== undefined ? { share } : {}),
        });
    }
  }
  return out;
}

export function capabilities(
  d: DiagramFile,
  node: DiagramNode,
  topology: CompiledTopology = compileTopology(d),
  props?: ResolvedProps,
): Capability[] {
  return resolveCapabilities(d, topology, node, props)[node.id] ?? [];
}
