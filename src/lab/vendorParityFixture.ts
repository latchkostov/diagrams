import type { DiagramFile } from "../model/types";
import type { RouteTable } from "../model/requestRouting";

/** Invented Request chain for checking vendor inheritance, including retained routing tables. */
export function vendorParityFixture(stencil: string, table?: RouteTable, admission = false): DiagramFile {
  return {
    format: "diagrams/v2",
    title: "Vendor Request parity",
    planning: {
      revision: "p3-w2",
      requestRoutes: [{ id: "read", address: { method: "GET", path: "/items" } }],
    },
    nodes: [
      { id: "source", stencil: "client.browser", label: "Client", x: 0, y: 0, props: { ratePerSec: 4 } },
      {
        id: "caller",
        stencil: "generic.service",
        label: "Caller",
        x: 200,
        y: 0,
        props: { latencyMs: 10, jitter: 0, concurrency: 8, replicas: 1 },
      },
      {
        id: "work",
        stencil,
        label: "Work",
        x: 400,
        y: 0,
        props: {
          latencyMs: 20,
          jitter: 0,
          failureRate: 0,
          concurrency: 2,
          replicas: 1,
          ...(table ? { routeTable: table } : {}),
          ...(admission
            ? {
                api: {
                  maxInFlight: 2,
                  quotas: [
                    {
                      id: "requests",
                      unit: "requests",
                      amount: 2,
                      burst: 2,
                      windowMs: 1000,
                      algorithm: "token-bucket",
                    },
                  ],
                },
              }
            : {}),
        },
      },
      {
        id: "end",
        stencil: "generic.service",
        label: "Slow service",
        x: 600,
        y: 0,
        props: { latencyMs: 250, jitter: 0, concurrency: 8, failureRate: 0 },
      },
      {
        id: "other",
        stencil: "generic.service",
        label: "Other service",
        x: 600,
        y: 200,
        props: { latencyMs: 250, jitter: 0, concurrency: 8, failureRate: 0 },
      },
    ],
    edges: [
      { id: "input", from: "source", to: "caller", kind: "sync", props: { travelMs: 10, requestRouteId: "read" } },
      { id: "in", from: "caller", to: "work", kind: "sync", props: { travelMs: 10, requestRouteId: "read" } },
      { id: "out", from: "work", to: "end", kind: "sync", props: { travelMs: 10 } },
      ...(table ? [{ id: "unused", from: "work", to: "other", kind: "sync" as const, props: { travelMs: 10 } }] : []),
    ],
  };
}
