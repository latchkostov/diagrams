import { describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";
import { sameDelivery } from "./delivery";

// The traffic-preservation helper itself: it must fail a change that loses or adds traffic, or it guards nothing.

const shop = (): DiagramFile => ({
  format: "diagrams/v1",
  title: "Shop",
  nodes: [
    { id: "web", stencil: "client.browser", label: "Web", x: 0, y: 0 },
    { id: "api", stencil: "service.go", label: "API", x: 300, y: 0 },
    { id: "db", stencil: "postgres", label: "Orders", x: 600, y: 0 },
  ],
  edges: [
    { id: "web-api", from: "web", to: "api", kind: "sync" },
    { id: "api-db", from: "api", to: "db", kind: "sync" },
  ],
});

describe("sameDelivery", () => {
  it("passes a change that only adds a dependency", () => {
    expect(() =>
      sameDelivery(shop(), [
        {
          label: "add a vault",
          ops: [
            { op: "add_node", kind: "vault", label: "Vault", key: "v" },
            { op: "connect", from: "api", to: "v", relation: "secret" },
          ],
        },
      ]),
    ).not.toThrow();
  });

  it("rejects removing an original terminal node, though every node left handles what it did", () => {
    expect(() =>
      sameDelivery(shop(), [{ label: "drop the database", ops: [{ op: "remove", targets: ["db"] }] }]),
    ).toThrow();
  });

  it("rejects a new node that takes traffic", () => {
    expect(() =>
      sameDelivery(shop(), [
        {
          label: "a flow to a cache",
          ops: [
            { op: "add_node", kind: "redis", label: "Cache", key: "c" },
            { op: "connect", from: "api", to: "c", kind: "sync" },
          ],
        },
      ]),
    ).toThrow();
  });
});
