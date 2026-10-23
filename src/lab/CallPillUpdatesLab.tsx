import { useState } from "react";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { toFlow } from "../canvas/convert";
import { DiagramNode } from "../canvas/nodes/DiagramNode";
import { CallPills } from "../live/CallPills";
import { resilienceFixture } from "./resilienceFixture";

const flow = toFlow(resilienceFixture());
const nodeTypes = { diagram: DiagramNode };

/** Stable occupancy and routing while only the memoized pill's settled counters change. */
export function CallPillUpdatesLab() {
  const [succeeded, setSucceeded] = useState(80);
  const [shortCircuited, setShortCircuited] = useState(0);
  return (
    <div>
      <div style={{ position: "relative", zIndex: 10 }}>
        <button data-testid="pill-add-successes" onClick={() => setSucceeded(180)}>
          Settle 100 successes
        </button>
        <button data-testid="pill-add-local-rejections" onClick={() => setShortCircuited(10)}>
          Exclude 10 local rejections
        </button>
      </div>
      <div className="lab-canvas" style={{ height: 500 }}>
        <ReactFlowProvider>
          <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView>
            <CallPills
              calls={[
                {
                  id: "call",
                  held: 4,
                  inFlight: 4,
                  windowRequests: 100,
                  windowAttempts: 200,
                  windowRetried: 100,
                  failed: 20,
                  succeeded,
                  shortCircuited,
                },
              ]}
            />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </div>
  );
}
