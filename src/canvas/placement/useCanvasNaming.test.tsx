// @vitest-environment happy-dom
import { act, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { useHistory, type CanvasSnapshot, type HistoryApi } from "../../editor/useHistory";
import { toFlow } from "../convert";
import { createInteractionController } from "../interaction/controller";
import { typeAheadActive } from "../typeAhead";
import { isDiagramNode } from "../types";
import { useCanvasNaming } from "./useCanvasEditCommands";

it("commits every buffered key and closes creation before releasing the next shortcut, without timers or reveal", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const defaultName = "Go Service";
  const initial = toFlow({ format: "diagrams/v1", title: "", nodes: [], edges: [] });
  const added = toFlow({
    format: "diagrams/v1",
    title: "",
    nodes: [{ id: "api", label: defaultName, stencil: "service.go", x: 0, y: 0 }],
    edges: [],
  });
  const controller = createInteractionController(
    {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => false,
      publish: () => {},
    },
    { frame: () => () => {}, microtask: (run) => run() },
  );
  let current!: CanvasSnapshot;
  let history!: HistoryApi;
  let pick!: () => void;
  let reveal!: () => void;
  const startEditing = vi.fn();
  function Harness() {
    const [snapshot, setSnapshot] = useState(initial);
    const h = useHistory(snapshot, setSnapshot);
    const rename = useRef(() => {});
    const editor = {
      getAnnotation: () => undefined,
      startEditing,
      updateNode: (id: string, patch: { label: string }) => {
        expect(typeAheadActive()).toBe(true);
        setSnapshot((s) => ({
          ...s,
          nodes: s.nodes.map((n) => (n.id === id && isDiagramNode(n) ? { ...n, data: { ...n.data, ...patch } } : n)),
        }));
      },
    } as unknown as EditorApi;
    const [, pickNamed] = useCanvasNaming(
      true,
      editor,
      () => {},
      () => {},
      () => {},
      rename,
      h,
      controller,
      (then) => {
        reveal = then!;
      },
    );
    useLayoutEffect(() => {
      current = snapshot;
      history = h;
      pick = () =>
        pickNamed(() => {
          h.begin("new:api");
          setSnapshot(added);
          return { id: "api", edge: null, merge: "new:api" };
        }, defaultName);
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  const shortcuts: string[] = [];
  const shortcut = (e: KeyboardEvent) => {
    if (!e.altKey || e.key !== "ArrowRight" || typeAheadActive()) return;
    expect(history.open()).toBeUndefined();
    expect(controller.mode.value).toBe("editing");
    shortcuts.push(current.nodes.filter(isDiagramNode)[0].data.label);
  };
  window.addEventListener("keydown", shortcut);
  try {
    await act(() => root.render(<Harness />));
    await act(() => pick());
    expect(controller.mode).toMatchObject({ value: "naming", target: "api" });
    await act(() => {
      for (const key of [..."Orders ingress API", "Enter"])
        window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
    });
    expect(shortcuts).toEqual(["Orders ingress API"]);
    await act(() => history.undo());
    expect(current.nodes).toEqual([]);
    await act(() => reveal());
    expect(startEditing).not.toHaveBeenCalled();
    await act(() => history.redo());
    expect(current.nodes.filter(isDiagramNode)[0].data.label).toBe("Orders ingress API");
  } finally {
    await act(() => root.unmount());
    window.removeEventListener("keydown", shortcut);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
