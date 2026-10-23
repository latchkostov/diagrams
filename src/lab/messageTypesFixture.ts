import type { DiagramFile } from "../model/types";

/** Callback enters the API again; Only pass Send breaks its accidental send loop. */
export function messageTypesFixture(): DiagramFile {
  return {
    format: "diagrams/v1",
    title: "Typed callback",
    nodes: [
      {
        id: "client",
        stencil: "client.browser",
        label: "Client",
        x: 40,
        y: 100,
        props: { messageType: "Send", ratePerSec: 2 },
      },
      { id: "api", stencil: "service.go", label: "API", x: 380, y: 100 },
      { id: "sender", stencil: "service.node", label: "Sender", x: 720, y: 100 },
    ],
    edges: [
      { id: "in", from: "client", to: "api", label: "Send request", kind: "async" },
      { id: "send", from: "api", to: "sender", label: "Dispatch", kind: "async" },
      { id: "callback", from: "sender", to: "api", label: "Callback", kind: "async", props: { emits: "Callback" } },
    ],
  };
}
