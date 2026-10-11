import { examples } from "../examples";
import type { DiagramFile, DiagramNode } from "../model/types";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const nodeStrings = (node: DiagramNode) => [node.id, node.label, node.sublabel ?? ""];
let fingerprints: Set<string> | undefined;

/** Only reached in development. Built once, from the already loaded local example registry. */
function localFingerprints(): Set<string> {
  if (fingerprints) return fingerprints;
  const stoplist = new Set([
    "service",
    "server",
    "client",
    "worker",
    "database",
    "processor",
    "storage",
    "message",
    "request",
    "response",
    "consumer",
    "producer",
    "queue",
    "topic",
    "cache",
    "kafka",
    "api gateway",
    "load balancer",
  ]);
  fingerprints = new Set(
    examples
      .filter((example) => example.localOnly)
      .flatMap(({ diagram }) => [
        ...diagram.nodes.flatMap(nodeStrings),
        ...diagram.edges.map((edge) => edge.label ?? ""),
      ])
      .map(normalize)
      .filter((value) => value.length >= 6 && !stoplist.has(value)),
  );
  return fingerprints;
}

export function matchesLocalExample(diagram: DiagramFile): boolean {
  const strings = localFingerprints();
  if (!strings.size || !diagram.nodes.length) return false;
  const edgeNodes = new Set<string>();
  for (const edge of diagram.edges) {
    if (edge.label && strings.has(normalize(edge.label))) {
      edgeNodes.add(edge.from);
      edgeNodes.add(edge.to);
    }
  }
  let matches = 0;
  for (const node of diagram.nodes) {
    if (edgeNodes.has(node.id) || nodeStrings(node).some((value) => strings.has(normalize(value)))) matches++;
  }
  return matches >= 3 || matches / diagram.nodes.length >= 0.2;
}

/** Synthetic fixtures only; tests reset the lazy cache after replacing the example registry. */
export function resetLocalFingerprintsForTest(): void {
  fingerprints = undefined;
}
