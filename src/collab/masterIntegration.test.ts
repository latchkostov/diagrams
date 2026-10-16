import { expect, it, onTestFinished } from "vitest";
import routingFixture from "../../tests/parity/corpus/r1-mix-table.diagram.json";
import { planBoundaryRefits } from "../editor/boundaryFit";
import type { RouteTable, TrafficMix } from "../model/requestRouting";
import type { DiagramFile } from "../model/types";
import { FakeClock } from "./clock";
import { openClient, roomFor } from "./transport/conformance";
import { MemoryNetwork } from "./transport/memory";

async function peers(initial: DiagramFile) {
  const net = new MemoryNetwork();
  const clock = new FakeClock();
  const room = roomFor(42);
  const a = await openClient("a", net.connect(), room, clock, 1, { initial });
  const b = await openClient("b", net.connect(), room, clock, 2);
  onTestFinished(async () => {
    await Promise.all([a.binding.close(), b.binding.close()]);
  });
  const settle = () => net.settle(async () => void (await Promise.all([a.session.idle(), b.session.idle()])));
  await settle();
  return { a, b, settle };
}

it("shares R1 routes, mixes, tables, admission, caller addresses and simulation edits as one undo step", async () => {
  const initial = routingFixture as DiagramFile;
  const { a, b, settle } = await peers(initial);
  expect(b.diagram).toEqual(initial);
  const table: RouteTable = {
    rules: [
      {
        id: "orders",
        match: { methods: ["POST"], path: { kind: "exact", value: "/orders" } },
        targets: [{ edgeId: "kong-orders", weight: 1 }],
        quotas: [{ id: "budget", unit: "requests", amount: 10, windowMs: 1000, algorithm: "token-bucket" }],
      },
    ],
  };
  const mix: TrafficMix = { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] };
  const changed: DiagramFile = {
    ...initial,
    planning: {
      ...initial.planning!,
      requestRoutes: initial.planning!.requestRoutes!.map((r) => ({ ...r, label: `Route ${r.id}` })),
    },
    nodes: initial.nodes.map((n) =>
      n.id === "app"
        ? { ...n, props: { ...n.props, trafficMix: mix } }
        : n.id === "kong"
          ? { ...n, props: { ...n.props, routeTable: table } }
          : n,
    ),
    edges: initial.edges.map((e) =>
      e.id === "app-kong"
        ? {
            ...e,
            props: {
              ...e.props,
              requestRouteId: "orders-post",
              requestFilter: { methods: ["POST"], path: { kind: "exact", value: "/orders" } },
            },
          }
        : e,
    ),
    simulations: initial.simulations!.map((s) => ({
      ...s,
      setup: { props: { app: { trafficMix: mix }, kong: { routeTable: table } } },
      timeline: [{ atMs: 1000, action: { do: "props", node: "kong", props: { routeTable: table } } }],
    })),
  };
  expect(a.edit(() => changed)).toBe(true);
  expect(a.session.doc.project().status).toBe("ok");
  // A peer's unrelated edit must survive the route author's Undo.
  expect(b.edit((d) => ({ ...d, title: "Peer title" }))).toBe(true);
  await settle();
  expect(a.diagram).toEqual({ ...changed, title: "Peer title" });
  expect(b.diagram).toEqual(a.diagram);
  expect(a.binding.undo()).toBe(true);
  await settle();
  expect(b.diagram).toEqual({ ...initial, title: "Peer title" });
  expect(a.binding.redo()).toBe(true);
  await settle();
  expect(b.diagram).toEqual({ ...changed, title: "Peer title" });
});

it("shares bottom-up boundary refits with node movement in one undo step", async () => {
  const initial: DiagramFile = {
    format: "diagrams/v1",
    title: "Nested service",
    groups: [
      { id: "outer", label: "Outer", x: 0, y: 0, width: 600, height: 400 },
      { id: "inner", label: "Inner", group: "outer", x: 40, y: 40, width: 400, height: 200 },
    ],
    nodes: [{ id: "service", stencil: "generic.service", label: "Service", group: "inner", x: 100, y: 100 }],
    edges: [],
  };
  const { a, b, settle } = await peers(initial);
  const nodes = initial.nodes.map((n) => ({ ...n, x: 800, y: 500 }));
  const refits = planBoundaryRefits(
    initial.groups!,
    nodes.map((n) => ({ ...n, width: 220, height: 72 })),
  );
  expect(refits.size).toBe(2);
  const changed = { ...initial, nodes, groups: initial.groups!.map((g) => ({ ...g, ...refits.get(g.id) })) };
  expect(a.edit(() => changed)).toBe(true);
  await settle();
  expect(b.diagram).toEqual(changed);
  expect(a.binding.undo()).toBe(true);
  await settle();
  expect(b.diagram).toEqual(initial);
  expect(a.binding.redo()).toBe(true);
  await settle();
  expect(b.diagram).toEqual(changed);
});
