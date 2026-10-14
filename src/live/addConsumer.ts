import type { EditorApi } from "../editor/types";
import { flowEdges } from "../model/relations";
import { stencilRole } from "../stencils/roles";

/**
 * "Nobody reads Kafka Topic" › Add a consumer: a service one gap downstream of the broker, reading it, named for
 * it ("Kafka Topic consumer"), as one undo step. It looks like the services around it: the stencil of a service
 * that publishes to the broker, else a generic service. Returns the new node's id.
 */
export function addConsumer(editor: EditorApi, brokerId: string): string | null {
  const d = editor.getDiagram();
  const broker = d.nodes.find((n) => n.id === brokerId);
  if (!broker) return null;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const producer = flowEdges(d.edges)
    .filter((e) => e.to === brokerId)
    .map((e) => byId.get(e.from))
    .find((n) => n && stencilRole(n.stencil) === "processor");
  const made = editor.createConnected({ from: brokerId, stencil: producer?.stencil ?? "generic.service" });
  if (!made) return null;
  // Same tick and the creation's own merge key: the node, its edge and its name are one undo step.
  editor.updateNode(made.id, { label: `${broker.label || broker.id} consumer` }, { merge: made.merge });
  return made.id;
}
