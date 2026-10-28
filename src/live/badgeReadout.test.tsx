// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NodeBadges } from "./NodeBadges";
import { suspendFrameCapture } from "../canvas/camera/frameCapture";
import type { LiveState } from "./controller";
import { waitingFixture } from "../lab/waitingFixture";
import * as format from "./format";
import { refresh } from "./badgeSemantics";

const store = vi.hoisted(() => ({ domNode: null as HTMLElement | null, transform: [0, 0, 1] }));
const node = {
  id: "caller",
  type: "diagram",
  data: { stencil: "generic.service", label: "Caller" },
  position: { x: 0, y: 0 },
};
vi.mock("@xyflow/react", () => ({
  useNodes: () => [node],
  useStore: (select: (s: object) => unknown) => select(store),
  useStoreApi: () => api,
}));
const api = { getState: () => store, subscribe: () => () => {} };
vi.mock("../canvas/viewportParts", async (original) => ({
  ...(await original<typeof import("../canvas/viewportParts")>()),
  viewportParts: () => () => new Set(),
}));
vi.mock("./lazyWaitingVisuals", async () => ({
  ThreadMeter: (await import("./ThreadMeter")).ThreadMeter,
  CallPills: () => null,
}));
const listeners = new Set<() => void>();
let current: LiveState;
const controller = {
  currentDiagram: waitingFixture(),
  getState: () => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
vi.mock("./context", () => ({ useLive: () => ({ controller }) }));
vi.mock("../canvas/DiagramContext", () => ({ useDiagram: () => ({ editing: null }) }));
vi.mock("../canvas/interaction", () => ({ useInteraction: () => null }));

function state(working: number, inFlight: number): LiveState {
  return {
    inputs: {},
    configuration: {},
    snapshot: {
      nodes: {
        caller: {
          id: "caller",
          role: "processor",
          status: "up",
          processed: working,
          inFlight: 0,
          throughput: working,
          backlog: 0,
          failed: 0,
          dropped: 0,
          deadLettered: 0,
          lag: {},
          threads: { slots: 4, working, waiting: 1, inFlight, queued: 0, waitingOn: [] },
        },
      },
      edges: {},
    },
  } as unknown as LiveState;
}

async function mounted() {
  const host = document.createElement("div");
  host.className = "react-flow__viewport";
  const container = document.createElement("div");
  host.append(container);
  document.body.append(host);
  store.domNode = host.parentElement;
  const root = createRoot(container);
  const publish = async (s: LiveState) => {
    current = s;
    for (const listener of listeners) listener();
    await act(async () => {
      root.render(<NodeBadges state={s} presenting={false} />);
    });
  };
  await publish(state(0, 0));
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  const badge = host.querySelector('[data-testid="node-badge-caller"]')!;
  expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
  return {
    host,
    badge,
    publish,
    dispose: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  store.domNode = null;
  vi.unstubAllGlobals();
});

it("updates off-screen meter values and accessible text without viewport or focus changes", async () => {
  const m = await mounted();
  try {
    const focus = document.activeElement;
    const meter = m.badge.querySelector('[data-testid="thread-readout-caller"]')!;
    const readout = meter.parentElement!;
    expect(meter.getAttribute("aria-valuenow")).toBe("1");
    await m.publish(state(2, 7));
    expect(document.activeElement).toBe(focus);
    expect(store.transform).toEqual([0, 0, 1]);
    expect(meter.getAttribute("role")).toBe("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("3");
    expect(meter.getAttribute("aria-valuetext")).toBe("7 calls in flight, no thread held");
    expect(meter.getAttribute("aria-label")).toBe("3 of 4 threads busy");
    expect(readout.hidden).toBe(false);
    expect(readout.getAttribute("aria-label")).toContain("Processed: 2");
    // Only visual work waits. The test must exercise the frozen badge, not a full re-render.
    expect(m.badge.getAttribute("data-processed")).toBe("0");
    await m.publish(state(0, 0));
    expect(meter.hasAttribute("aria-valuetext")).toBe(false);
    const unknown = state(2, 7);
    unknown.snapshot.nodes.caller.threads!.slots = Infinity;
    await m.publish(unknown);
    expect(meter.hasAttribute("role")).toBe(false);
    expect(meter.hasAttribute("aria-valuenow")).toBe(false);
    expect(meter.hasAttribute("aria-valuemax")).toBe(false);
    expect(meter.textContent).toContain("capacity unknown");
    const removed = state(0, 0);
    delete removed.snapshot.nodes.caller.threads;
    await m.publish(removed);
    expect(meter.hasAttribute("role")).toBe(false);
    expect(meter.textContent).toBe("");
  } finally {
    m.dispose();
  }
});

it("capture commits the latest off-screen badge before returning", async () => {
  const m = await mounted();
  try {
    await m.publish(state(2, 7));
    expect(m.badge.getAttribute("data-processed")).toBe("0");
    // Deliberately outside act: capture consumes DOM in this very task.
    const restore = suspendFrameCapture(m.host);
    try {
      expect(m.badge.getAttribute("data-processed")).toBe("2");
      expect(m.badge.querySelector('[data-testid="thread-readout-caller"]')).toBeNull();
      expect(m.badge.firstElementChild!.getAttribute("aria-hidden")).toBeNull();
    } finally {
      act(restore);
    }
  } finally {
    m.dispose();
  }
});

it("refreshes an off-screen capacity label after its React commit without another publication", async () => {
  const m = await mounted();
  try {
    const capacity = document.createElement("span");
    capacity.dataset.testid = "capacity-label-caller";
    capacity.setAttribute("aria-label", "Caller: healthy, 10/s");
    m.badge.append(capacity);
    const readout = () => m.badge.querySelector("[data-badge-semantics-text]")!.getAttribute("aria-label");
    await vi.waitFor(() => expect(readout()).toContain("Caller: healthy, 10/s"));
    capacity.setAttribute("aria-label", "Caller: busy, 20/s");
    await vi.waitFor(() => expect(readout()).toContain("Caller: busy, 20/s"));
    expect(readout()).not.toContain("10/s");
  } finally {
    m.dispose();
  }
});

it("formats each off-screen publication once across repeated viewport and DOM notifications", async () => {
  const m = await mounted();
  const rate = vi.spyOn(format, "formatRate");
  try {
    const visible = new Set<string>();
    refresh(m.host, current, visible, controller.currentDiagram);
    expect(rate).not.toHaveBeenCalled();
    const next = state(2, 7);
    refresh(m.host, next, visible, controller.currentDiagram);
    refresh(m.host, next, visible, controller.currentDiagram);
    expect(rate).toHaveBeenCalledTimes(1);
    m.badge.querySelector("[data-badge-semantics-text]")!.remove();
    refresh(m.host, next, visible, controller.currentDiagram);
    expect(rate).toHaveBeenCalledTimes(2);
    expect(m.badge.querySelector('[data-testid="thread-readout-caller"]')!.getAttribute("aria-valuenow")).toBe("3");
  } finally {
    rate.mockRestore();
    m.dispose();
  }
});
