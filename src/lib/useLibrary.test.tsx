// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { createLibraryDiagram, DIAGRAMS_CHANGED, writeAutosave } from "./diagramIO";
import { useLibrary } from "./useLibrary";
import type { DiagramFile } from "../model/types";

it("content saves notify readers without rendering the closed picker, which refreshes before opening", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const diagram: DiagramFile = {
    format: "diagrams/v1",
    title: "Library snapshot",
    nodes: [{ id: "a", stencil: "service.node", label: "A", x: 0, y: 0 }],
    edges: [],
  };
  const slug = createLibraryDiagram(diagram);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let renders = 0;
  let latest: ReturnType<typeof useLibrary> | undefined;
  const snapshot = () => {
    if (!latest) throw new Error("Library has not mounted");
    return latest;
  };
  function Probe() {
    renders++;
    latest = useLibrary();
    return null;
  }
  const changed = vi.fn();
  window.addEventListener(DIAGRAMS_CHANGED, changed);
  try {
    await act(() => root.render(<Probe />));
    const before = renders;
    vi.setSystemTime(2000);
    await act(() => {
      writeAutosave(slug, { ...diagram, nodes: [{ ...diagram.nodes[0], label: "Renamed node" }] });
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(renders).toBe(before);
    expect(snapshot().entries.find((e) => e.slug === slug)?.updatedAt).toBe(1000);
    await act(() => snapshot().refresh());
    expect(snapshot().entries.find((e) => e.slug === slug)?.updatedAt).toBe(2000);
    const refreshed = renders;
    await act(() => {
      writeAutosave(slug, { ...diagram, title: "Updated title" });
    });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(renders).toBe(refreshed + 1);
    expect(snapshot().entries.find((e) => e.slug === slug)?.title).toBe("Updated title");
    // Other tabs still refresh the picker even for content-only changes.
    await act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(renders).toBe(refreshed + 2);
  } finally {
    window.removeEventListener(DIAGRAMS_CHANGED, changed);
    await act(() => root.unmount());
    host.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
