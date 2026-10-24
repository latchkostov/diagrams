// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { sheddingFixture } from "../../lab/resilienceFixture";
import { LiveController } from "../../live/controller";
import type { LiveUi } from "../../live/context";
import { planningHost } from "../../live/planningHost";
import { parseNative } from "../../interop/native";
import { editorHarness } from "../../test/editorHarness";
import { useSimulationSetting } from "./useSimulationSetting";

async function probe(
  run: (ctx: {
    editor: EditorApi;
    controller: LiveController;
    setting: () => ReturnType<typeof useSimulationSetting>;
    render: () => Promise<void>;
  }) => Promise<void>,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const diagram = sheddingFixture();
  diagram.simulations![0].setup!.edges = { call: { caller: { deadlineMs: 150 } } };
  const h = editorHarness(diagram);
  h.deps.setMeta = (update) => {
    h.deps.meta = typeof update === "function" ? update(h.deps.meta) : update;
    h.commit();
  };
  const controller = new LiveController(diagram);
  controller.selectSimulation(diagram.simulations![0]);
  const stop = planningHost.publish({ controller, slowmo: { active: false } } as LiveUi);
  const root = createRoot(document.createElement("div"));
  let current: ReturnType<typeof useSimulationSetting>;
  function Probe() {
    current = useSimulationSetting(h.api, "edge", "call", "priority");
    return null;
  }
  const render = async () => {
    await act(() => root.render(<Probe />));
  };
  try {
    await render();
    await run({ editor: h.api, controller, setting: () => current, render });
  } finally {
    await act(() => root.unmount());
    stop();
    controller.dispose();
    vi.unstubAllGlobals();
  }
}

it("editing connection priority preserves saved simulations and their overrides after reopening", async () => {
  await probe(async ({ editor, controller, setting, render }) => {
    const saved = structuredClone(editor.getDiagram().simulations);
    await act(() => setting().set("critical"));
    await render();
    expect(setting().value).toBe("critical");
    expect(editor.getEdge("call")?.props?.priority).toBe("critical");
    expect(editor.getDiagram().simulations).toEqual(saved);
    expect(controller.getState().simulation).toEqual(saved![0]);
    const reopened = parseNative(JSON.stringify(editor.getDiagram()));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.error);
    expect(reopened.warnings).toEqual([]);
    expect(reopened.diagram.simulations).toEqual(saved);
  });
});

it("caches simulation equality across Live metric updates and invalidates it for changed drafts", async () => {
  await probe(async ({ controller, setting, render }) => {
    const saved = controller.getState().simulation!;
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      for (let tick = 0; tick < 8; tick++) await act(() => controller.step(100));
      expect(stringify.mock.calls.filter(([value]) => value === saved)).toHaveLength(0);
      expect(setting().editable).toBe(true);
      await act(() => controller.selectSimulation({ ...saved, durationMs: 9000 }));
      await render();
      expect(setting().editable).toBe(false);
      expect(stringify.mock.calls.some(([value]) => value === saved)).toBe(true);
    } finally {
      stringify.mockRestore();
    }
  });
});
