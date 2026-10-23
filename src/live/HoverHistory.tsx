import { useState } from "react";
import { useLive, useLiveState } from "./context";
import { SampleSparkline } from "./Sparkline";

/** Only mounted in a pinned card: bounded history for the one readout being inspected. */
export function HoverHistory({ id }: { id: string }) {
  const ui = useLive();
  const { snapshot } = useLiveState(ui.controller);
  const value = snapshot.nodes[id]?.throughput ?? 0;
  const [history, setHistory] = useState({ at: snapshot.time, samples: [value] });
  if (snapshot.time < history.at) setHistory({ at: snapshot.time, samples: [value] });
  else if (snapshot.time - history.at >= 1000)
    setHistory({ at: snapshot.time, samples: [...history.samples.slice(-9), value] });
  return <SampleSparkline samples={history.samples} />;
}
