import { describe, expect, it } from "vitest";
import { applyOps } from "./ops";
import { describeDiagram } from "./describe";
import type { DiagramFile } from "../model/types";
import { routingFixture } from "../lab/routingFixture";

const empty = (): DiagramFile => ({
  format: "diagrams/v2",
  planning: { revision: "p3-a1" },
  title: "Agent routing",
  nodes: [],
  edges: [],
});

describe("agent request routing", () => {
  it("builds routes, a mix and a table in one batch, resolving connection keys to ids", () => {
    const result = applyOps(empty(), [
      { op: "add_node", kind: "client.mobile", label: "App", key: "app" },
      { op: "add_node", kind: "kong", label: "Gateway", key: "gw" },
      { op: "add_node", kind: "generic.service", label: "Orders", key: "orders" },
      { op: "connect", from: "app", to: "gw", key: "in" },
      { op: "connect", from: "gw", to: "orders", key: "to-orders" },
      { op: "set_meta", requestRoutes: [{ id: "orders-post", address: { method: "POST", path: "/orders" } }] },
      {
        op: "update",
        target: "app",
        props: { trafficMix: { mode: "shares", entries: [{ routeId: "orders-post", share: 1 }] } },
      },
      {
        op: "update",
        target: "gw",
        props: {
          routeTable: {
            rules: [{ id: "orders", match: { methods: ["POST"] }, targets: [{ edgeId: "to-orders", weight: 1 }] }],
          },
        },
      },
    ]);
    expect(result.errors).toEqual([]);
    const gw = result.diagram.nodes.find((n) => n.label === "Gateway")!;
    const edge = result.diagram.edges.find((e) => e.to === result.diagram.nodes.find((n) => n.label === "Orders")!.id)!;
    expect((gw.props!.routeTable as { rules: { targets: { edgeId: string }[] }[] }).rules[0].targets[0].edgeId).toBe(
      edge.id,
    );
    // A new route gets a colour and marker of its own.
    expect(result.diagram.planning!.requestRoutes![0].appearance).toEqual({ paletteSlot: 0, marker: "circle" });
  });

  it("refuses a new table on a stencil that doesn't route HTTP, and a dangling reference, in a dry run too", () => {
    const d = routingFixture();
    for (const dryRun of [false, true]) {
      const onService = applyOps(d, [{ op: "update", target: "orders", props: { routeTable: { rules: [] } } }], {
        dryRun,
      });
      expect(onService.ok).toBe(false);
      expect(onService.errors[0].error).toContain("HTTP router");
      const dangling = applyOps(
        d,
        [{ op: "set_meta", requestRoutes: [{ id: "only", address: { method: "GET", path: "/" } }] }],
        { dryRun },
      );
      expect(dangling.ok).toBe(false);
      expect(dangling.errors[0].error).toContain("orders-post");
    }
  });

  it("null removes a whole table, restoring round-robin", () => {
    const result = applyOps(routingFixture(), [{ op: "update", target: "kong", props: { routeTable: null } }]);
    expect(result.ok).toBe(true);
    expect(result.diagram.nodes.find((n) => n.id === "kong")!.props!.routeTable).toBeUndefined();
  });

  it("describe_diagram lists the routes and the configured demand per route", () => {
    const text = describeDiagram(routingFixture());
    expect(text).toContain("request routes (2):");
    expect(text).toContain('"orders-post" POST "/orders"');
    expect(text).toMatch(/route demand "kong" "search-get": offered 80 req\/s, refused 404 0 req\/s/);
    const json = JSON.parse(describeDiagram(routingFixture(), { format: "json" }));
    expect(json.routeDemand.kong["orders-post"].offered).toBeCloseTo(20);
  });
});
