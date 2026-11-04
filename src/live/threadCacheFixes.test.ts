// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { cacheFixture } from "../lab/cacheFixture";
import { LiveController } from "./controller";
import { planningHost } from "./planningHost";
import { applyThreadFix } from "./threadFixes";
import { coalesceRule } from "../sim/cachePresets";
import type { CacheTable } from "../model/caching";
import type { EditorApi } from "../editor/types";
import { notify } from "../interop/ui/toast";
import "../sim/cache/cacheRuntime";

vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));

it.each(["diagram", "saved", "draft", "slowmo", "unchanged"])(
  "the cache callout uses the shared writer's ownership, guards and no-op handling (%s)",
  (mode) => {
    const diagram = cacheFixture();
    diagram.simulations = [{ id: "run", title: "Saved", traffic: [], setup: { props: { cache: { latencyMs: 17 } } } }];
    const table = diagram.nodes[1].props!.cache as CacheTable;
    const cache = mode === "unchanged" ? structuredClone(table) : coalesceRule(table, "");
    const editor = {
      getDiagram: () => diagram,
      updateMeta: vi.fn<EditorApi["updateMeta"]>((patch) => Object.assign(diagram, patch)),
      setNodeProps: vi.fn(),
    };
    const controller = new LiveController(diagram);
    if (mode !== "diagram")
      controller.selectSimulation({ ...diagram.simulations[0], ...(mode === "draft" ? { title: "Draft" } : {}) });
    const host = vi
      .spyOn(planningHost, "get")
      .mockReturnValue({ slowmo: { active: mode === "slowmo" } } as ReturnType<typeof planningHost.get>);
    vi.mocked(notify).mockClear();
    try {
      applyThreadFix(
        { editor: editor as unknown as EditorApi, controller, interaction: null },
        { kind: "cache", node: "cache", rule: "", step: "coalesce", cache },
        "One fetch per item",
      );
      expect(editor.setNodeProps).toHaveBeenCalledTimes(mode === "diagram" ? 1 : 0);
      expect(editor.updateMeta).toHaveBeenCalledTimes(mode === "saved" ? 1 : 0);
      expect(notify).toHaveBeenCalledTimes(mode === "diagram" || mode === "saved" ? 1 : 0);
      if (mode === "saved") {
        expect(diagram.simulations[0].setup?.props?.cache).toEqual({ latencyMs: 17, cache });
        expect(controller.getState().configuration.cache.cache).toEqual(cache);
        expect(diagram.nodes[1].props!.cache).toEqual(table);
      }
    } finally {
      host.mockRestore();
      controller.dispose();
    }
  },
);
