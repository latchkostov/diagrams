import { recordAssignment, type ConsumerAssignment, type BrokerSpec } from "../model/brokers";
import type { DiagramFile } from "../model/types";
import { stencilRole } from "../stencils/roles";
import { resolveProps, type ResolvedProps } from "./defaults";
import { allocateGroupReplicas, compileTopology } from "./topology";

/** Broker lag vocabulary and upstream consumer limits are different facts, even on the same node. */
export function brokerAssignments(
  diagram: DiagramFile,
  configuration?: Record<string, Record<string, unknown>>,
  capacityMultiplier = 1,
) {
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const resolved = new Map<string, ResolvedProps>();
  const propsOf = (id: string) => {
    let props = resolved.get(id);
    if (!props) {
      const node = nodes.get(id)!;
      props = resolveProps(
        stencilRole(node.stencil),
        node.label,
        configuration?.[id] ?? node.props ?? {},
        node.stencil,
        diagram.planning,
      );
      resolved.set(id, props);
    }
    return props;
  };
  const brokers = new Map<string, BrokerSpec>();
  const consumers = new Map<string, ConsumerAssignment>();
  for (const [id, groups] of compileTopology(diagram).groups) {
    const node = nodes.get(id)!;
    const props = propsOf(id);
    if (props.broker) brokers.set(id, props.broker);
    for (const group of groups) {
      const allocated = allocateGroupReplicas(
        stencilRole(node.stencil),
        props.partitions,
        group.members.map((id) => {
          const member = nodes.get(id)!;
          return {
            id,
            role: stencilRole(member.stencil),
            replicas: Math.max(1, Math.round(propsOf(id).replicas * capacityMultiplier)),
          };
        }),
        props.broker?.partitioned ?? false,
      );
      for (const [id, count] of allocated)
        recordAssignment(consumers, id, count, props.broker?.partitioned ? props.broker : undefined);
    }
  }
  return { brokers, consumers };
}
