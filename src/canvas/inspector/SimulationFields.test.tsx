import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { EditorApi } from "../../editor/types";
import { NodeSimulation } from "./SimulationFields";

it("summarizes rates-mode source traffic with its effective total instead of the dormant rate", () => {
  const title = "Invented traffic";
  const html = renderToStaticMarkup(
    <NodeSimulation
      nodeId="source"
      stencil="client.user"
      editor={{} as EditorApi}
      meta={{ title, planning: { revision: "p3-a1", requestRoutes: [] } }}
      props={{
        ratePerSec: 999,
        trafficMix: {
          mode: "rates",
          entries: [
            { routeId: "browse", ratePerSec: 12 },
            { routeId: "buy", ratePerSec: 18 },
          ],
        },
      }}
      routed
      router={false}
      mixer
      routing={null}
    />,
  );
  expect(html).toContain('data-testid="inspector-summary-node-simulation"');
  expect(html).toContain("30 msg/s");
  expect(html).not.toContain("999 msg/s");
});
