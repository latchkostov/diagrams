import { observationPorts, type ProductObservations } from "../lib/observations";

/** Camera movement often republishes the same view. Dock readers need only changed facts. */
export function publishDockObservation(next: ProductObservations["dock"]) {
  const previous = observationPorts.dock.get();
  if (
    previous &&
    previous.documentId === next.documentId &&
    previous.identity === next.identity &&
    previous.tab === next.tab &&
    previous.snap === next.snap &&
    previous.live === next.live &&
    previous.presenting === next.presenting &&
    previous.view === next.view
  )
    return;
  observationPorts.dock.publish(next);
}
