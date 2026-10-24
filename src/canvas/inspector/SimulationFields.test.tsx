import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { brokerSpec } from "../../model/brokers";
import { deviceSpec } from "../../stencils/netDevices";
import type { EditorApi } from "../../editor/types";
import { NodeSimulation } from "./SimulationFields";

it("summarizes rates-mode source traffic with its effective total instead of the dormant rate", () => {
  const label = "Shop";
  const title = "Invented traffic";
  const role = "source";
  const html = renderToStaticMarkup(
    <NodeSimulation
      node={{ id: "source", type: "diagram", position: { x: 0, y: 0 }, data: { stencil: "client.user", label } }}
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
      role={role}
      broker={brokerSpec("client.user", "source")}
      simFields={["ratePerSec"]}
      managed={false}
      device={deviceSpec("client.user")}
      merge={(field) => ({ merge: field })}
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
