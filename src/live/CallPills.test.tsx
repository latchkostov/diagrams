import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { intersects } from "../canvas/geometry/rect";
import { CallPills } from "./CallPills";

vi.mock("@xyflow/react", () => ({
  useStore: (select: (s: object) => unknown) =>
    select({ nodeLookup: new Map(), transform: [0, 0, 1], width: 1000, height: 800 }),
}));
vi.mock("../canvas/edges/useEdgeRoute", () => ({
  useRoutingOptions: () => ({}),
  useAllRoutes: () =>
    new Map([
      [
        "call",
        {
          points: [
            { x: 440, y: 72 },
            { x: 440, y: 160 },
          ],
        },
      ],
    ]),
  routeInputFromStore: () => ({ nodes: [{ rect: { x: 330, y: 0, width: 220, height: 72 } }] }),
}));

it.each([1, 1.6])("reserves live node readouts at counter-scale %s", (readoutScale) => {
  const markup = renderToStaticMarkup(
    <CallPills calls={[{ id: "call", held: 4, inFlight: 4 }]} readoutScale={readoutScale} />,
  );
  const position = /left:([\d.-]+)px;top:([\d.-]+)px/.exec(markup);
  expect(position).not.toBeNull();
  const box = { x: Number(position![1]), y: Number(position![2]), width: 100, height: 20 };
  expect(intersects(box, { x: 330, y: 79, width: 320 * readoutScale, height: 21 * readoutScale })).toBe(false);
});
