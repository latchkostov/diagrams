// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { sheddingFixture } from "../lab/resilienceFixture";
import { editorHarness } from "../test/editorHarness";
import { HistoryController } from "../editor/historyController";
import { selectionOf } from "../editor/historySelection";
import type { CanvasSnapshot } from "../editor/useHistory";
import { effectiveCallerPolicy } from "../editor/callerPolicy";
import { toast } from "../interop/ui/toast";
import { LiveController } from "./controller";
import type { LiveUi } from "./context";
import { planningHost } from "./planningHost";
import { LiveSync } from "./session/liveSync";
import { applyThreadFix, type ThreadFixAction } from "./threadFixes";

it.each([false, true])("applies a shedding fix and undoes both policies together (saved=%s)", (saved) => {
  const d = sheddingFixture();
  d.simulations![0].setup!.edges = { call: { caller: { deadlineMs: 150, replyMs: 20 } } };
  d.simulations![0].setup!.props!.partner.failureRate = 0.1;
  const h = editorHarness(d);
  const snapshot = (): CanvasSnapshot => ({ nodes: h.nodes(), edges: h.edges(), meta: h.deps.meta });
  const history = new HistoryController(snapshot(), 0);
  const apply = (next: CanvasSnapshot) => {
    h.deps.setNodes(next.nodes);
    h.deps.setEdges(next.edges);
    h.deps.meta = next.meta;
    h.commit();
  };
  h.deps.setMeta = (update) => {
    h.deps.meta = typeof update === "function" ? update(h.deps.meta) : update;
    h.commit();
  };
  h.deps.history.replace = (next, merge) => {
    history.replace(snapshot(), undefined, next, merge, selectionOf(snapshot()), 1);
    apply(next);
  };
  h.deps.history.undo = () => {
    history.commit(snapshot(), undefined, 2);
    const previous = history.step("undo", selectionOf(snapshot()));
    if (previous) apply(previous);
  };
  const controller = new LiveController(d, { replayDelayMs: 0 });
  const sync = new LiveSync(controller);
  sync.simulations(d.simulations!, () => undefined);
  if (saved) controller.selectSimulation(d.simulations![0]);
  const stop = planningHost.publish({ controller, slowmo: { active: false } } as LiveUi);
  const synchronize = () => {
    sync.diagram(h.api.getDiagram);
    sync.simulations(h.api.getDiagram().simulations!, () => undefined);
  };
  const action: ThreadFixAction = {
    kind: "resilience",
    step: "shedding",
    edge: "call",
    caller: { ...effectiveCallerPolicy(h.api, "call")!.caller, breaker: { minimumCalls: 2 } },
    queue: { node: "partner", policy: { limit: 7, whenFull: "reject-new", order: "fifo" } },
  };
  const before = structuredClone(h.api.getDiagram());
  const beforeRun = structuredClone(controller.getState().running);
  try {
    applyThreadFix({ editor: h.api, controller, interaction: null }, action, "Shed load");
    synchronize();
    expect(effectiveCallerPolicy(h.api, "call")!.caller).toEqual(action.caller);
    expect(controller.getState().snapshot.nodes.partner.queueLimit).toBe(7);
    const changed = h.api.getDiagram();
    if (saved) {
      expect(changed.nodes).toEqual(before.nodes);
      expect(changed.edges).toEqual(before.edges);
      expect(changed.simulations![0].setup!.edges!.call.caller).toEqual(action.caller);
      expect(changed.simulations![0].setup!.props!.partner).toEqual({
        ...before.simulations![0].setup!.props!.partner,
        queue: action.queue!.policy,
      });
    } else {
      expect(changed.simulations).toEqual(before.simulations);
      expect(h.api.getEdge("call")!.props).toEqual({ ...before.edges[1].props, caller: action.caller });
      expect(h.api.getNode("partner")!.props).toEqual({ ...before.nodes[2].props, queue: action.queue!.policy });
    }
    expect(toast.current?.action?.testId).toBe("thread-fix-undo");
    toast.current!.action!.run();
    synchronize();
    expect(h.api.getDiagram()).toEqual(before);
    expect(controller.getState().running).toEqual(beforeRun);
    expect(controller.getState().snapshot.nodes.partner.queueLimit).toBe(saved ? 2 : 3);
    expect(effectiveCallerPolicy(h.api, "call")!.caller.breaker).toBeUndefined();
  } finally {
    stop();
    controller.dispose();
    toast.dismiss();
  }
});
