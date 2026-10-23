import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { intersects } from "../canvas/geometry/rect";
import { CallPills } from "./CallPills";
import { ThreadCeiling } from "./ThreadCeiling";

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
            { x: 440, y: 300 },
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

it.each([true, false])("shows the pool and its queue in the existing pill (held: %s)", (held) => {
  const markup = renderToStaticMarkup(
    <CallPills
      calls={[
        {
          id: "call",
          held: held ? 100 : 0,
          inFlight: 40,
          queued: held ? 60 : 312,
          pool: 40,
          from: "Checkout",
          to: "Payment provider",
        },
      ]}
      readoutScale={1.8}
      presenting
    />,
  );
  expect(markup).toContain(held ? "40 calls · 60 waiting for a connection" : "40 of 40 connections · 312 queued");
  expect(markup).toContain(held ? "100 Checkout threads held" : "no thread held");
  expect(markup).toContain("transform:scale(1.8)");
  expect(markup).toContain('aria-label="');
  expect(markup).toContain('data-call-edge="call"');
  expect(markup).not.toContain('title="');
});

it("explains the pool ceiling instead of claiming all free threads can send calls", () => {
  const html = renderToStaticMarkup(
    <ThreadCeiling
      noun="threads"
      wait={{
        workMs: 10,
        callMs: 15,
        threadHoldMs: 25,
        memoryResidenceMs: 200,
        replyMs: 15,
        poolCeiling: 200,
        slots: 100,
        ceiling: 4000,
      }}
    />,
  );
  expect(html).toContain("Connection pool limits calls to 200 req/s");
  expect(html).not.toContain("4,000 req/s");
});
