import type { DiagramFile } from "../model/types";
import type { RequestRoute, RouteTable, TrafficMix } from "../model/requestRouting";

/**
 * Request routing R1's constructed public system for the Lab and tests: a mobile app sends a mix of two routes
 * through a Kong-style gateway, whose ordered table sends POST /orders to Orders with a 10% canary and GET /search
 * to Search. No Default: anything else is refused 404. Invented names only.
 */
export const ROUTING_ROUTES: RequestRoute[] = [
  { id: "orders-post", address: { method: "POST", path: "/orders" }, appearance: { paletteSlot: 0, marker: "circle" } },
  { id: "search-get", address: { method: "GET", path: "/search" }, appearance: { paletteSlot: 1, marker: "circle" } },
];
export const ROUTING_TABLE: RouteTable = {
  rules: [
    {
      id: "orders",
      match: { methods: ["POST"], path: { kind: "exact", value: "/orders" } },
      targets: [
        { edgeId: "kong-orders", weight: 90 },
        { edgeId: "kong-canary", weight: 10 },
      ],
    },
    {
      id: "search",
      match: { path: { kind: "prefix", value: "/search" } },
      targets: [{ edgeId: "kong-search", weight: 1 }],
    },
  ],
};
export const ROUTING_MIX: TrafficMix = {
  mode: "shares",
  entries: [
    { routeId: "orders-post", share: 0.2 },
    { routeId: "search-get", share: 0.8 },
  ],
};

export function routingFixture(options: { rate?: number; mix?: TrafficMix; table?: RouteTable } = {}): DiagramFile {
  const service = (id: string, label: string, x: number, y: number) => ({
    id,
    stencil: "generic.service",
    label,
    x,
    y,
    props: { latencyMs: 20, concurrency: 64, jitter: 0 },
  });
  return {
    format: "diagrams/v2",
    planning: { revision: "p3-a1", requestRoutes: structuredClone(ROUTING_ROUTES) },
    title: "Routing fixture",
    nodes: [
      {
        id: "app",
        stencil: "client.mobile",
        label: "Mobile app",
        x: 0,
        y: 120,
        props: { ratePerSec: options.rate ?? 100, trafficMix: structuredClone(options.mix ?? ROUTING_MIX) },
      },
      {
        id: "kong",
        stencil: "kong",
        label: "Gateway",
        x: 240,
        y: 120,
        props: { latencyMs: 5, jitter: 0, routeTable: structuredClone(options.table ?? ROUTING_TABLE) },
      },
      service("orders", "Orders", 520, 0),
      service("canary", "Orders canary", 520, 120),
      service("search", "Search", 520, 240),
    ],
    edges: [
      { id: "app-kong", from: "app", to: "kong", kind: "sync", props: { travelMs: 10 } },
      { id: "kong-orders", from: "kong", to: "orders", kind: "sync", props: { travelMs: 10 } },
      { id: "kong-canary", from: "kong", to: "canary", kind: "sync", props: { travelMs: 10 } },
      { id: "kong-search", from: "kong", to: "search", kind: "sync", props: { travelMs: 10 } },
    ],
  };
}

/**
 * The acceptance fixture for matching order and edge policy: a broad prefix before an exact rule (first match
 * wins), a rule whose only target's filter refuses it (no fall-through), a down canary keeping its share, and a
 * Default for the rest.
 */
export function routingOverlapFixture(): DiagramFile {
  const d = routingFixture({
    rate: 30,
    table: {
      rules: [
        {
          id: "broad",
          label: "Everything under /search",
          match: { path: { kind: "prefix", value: "/search" } },
          targets: [{ edgeId: "kong-search", weight: 1 }],
        },
        {
          id: "orders",
          match: { methods: ["POST"], path: { kind: "exact", value: "/orders" } },
          targets: [
            { edgeId: "kong-orders", weight: 9 },
            { edgeId: "kong-canary", weight: 1 },
          ],
        },
        {
          id: "filtered",
          match: { methods: ["DELETE"] },
          targets: [{ edgeId: "kong-orders", weight: 1 }],
        },
      ],
      default: { targets: [{ edgeId: "kong-search", weight: 1 }] },
    },
    mix: {
      mode: "shares",
      entries: [
        { routeId: "orders-post", share: 0.5 },
        { routeId: "search-get", share: 0.3 },
        { routeId: "orders-delete", share: 0.2 },
      ],
    },
  });
  d.title = "Routing: order, filters and a down canary";
  d.planning!.requestRoutes!.push({
    id: "orders-delete",
    address: { method: "DELETE", path: "/orders/42" },
    appearance: { paletteSlot: 5, marker: "triangle" },
  });
  d.edges.find((e) => e.id === "kong-orders")!.props!.requestFilter = { methods: ["POST"] };
  d.nodes.find((n) => n.id === "canary")!.props!.status = "down";
  return d;
}
