import { expect, it, vi } from "vitest";
import { createInteractionController, type InteractionPort } from "./interaction/controller";
import type { InteractionController } from "./interaction";
import type { TypeAhead } from "./typeAhead";
import { PanelUnavailable } from "./Inspector";

// Unit tests run without a DOM renderer: the marker is called as it mounts, its layout effect runs then, and it reads
// this controller from context. Nothing else commits, so only the marker can wake a parked request.
const context = vi.hoisted(() => ({ controller: null as InteractionController | null }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useLayoutEffect: (run: () => void) => void run(),
}));
vi.mock("./interaction/useInteraction", async (original) => ({
  ...(await original<typeof import("./interaction/useInteraction")>()),
  useInteraction: () => context.controller,
}));

// Mocks are hoisted above the imports: the Inspector module loads with them, before any test's time runs.
it("a failed panel's marker ends a pending rename as it mounts, without a commit of the sheet", () => {
  let failed = false;
  let holding = false;
  const port: InteractionPort = {
    active: () => null,
    // The DOM port: the field is parked until the marker for its owner is in the document, then gone.
    resolve: (target) => (target.kind === "field" ? { state: failed ? "gone" : "parked" } : { state: "gone" }),
    focus: () => false,
    connected: () => true,
    publish: () => {},
    holdKeys: () => {
      holding = true;
      return {
        stop: (): TypeAhead => {
          holding = false;
          return { text: "T" };
        },
      };
    },
  };
  const controller = createInteractionController(port, { frame: () => () => {}, microtask: (run) => run() });
  controller.connect();
  context.controller = controller;
  controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "e" });
  expect(holding).toBe(true);
  failed = true;
  PanelUnavailable({ owner: "e" });
  expect(holding).toBe(false);
  expect(controller.state.pending).toBeNull();
});
