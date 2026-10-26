import type { DiagramFile } from "../model/types";
import type { Trouble } from "./observedTrouble";

/** The service named by the status strip, independently of where a corrective action belongs. */
export function narrationSubject(trouble: Trouble | undefined, diagram: DiagramFile): string | undefined {
  if (trouble?.kind === "retry-storm") {
    // Verification may replace a corrective action with Events; its cause key still identifies the call.
    const edge =
      trouble.action.kind === "resilience"
        ? trouble.action.edge
        : trouble.key.startsWith("retry-storm:")
          ? trouble.key.slice("retry-storm:".length)
          : undefined;
    return diagram.edges.find((connection) => connection.id === edge)?.to ?? trouble.node;
  }
  return trouble?.node;
}
