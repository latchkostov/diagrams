// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EdgePanel } from "./EdgePanel";
import type { InspectorProps } from "./types";
import type { DiagramFlowEdge } from "../types";

it("keeps Config settings and live details distinct across inspector updates without React key errors", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const edge: DiagramFlowEdge = {
    id: "api-to-config",
    source: "api",
    target: "config",
    data: { kind: "async", relation: "config", props: { settings: [{ key: "PageSize", secret: false }] } },
  };
  const props = {
    editor: { getNode: () => undefined },
    meta: { title: edge.id },
    nodeLabel: (id: string) => id,
  } as unknown as InspectorProps;
  try {
    await act(() => root.render(<EdgePanel {...props} edge={edge} />));
    await act(() => root.render(<EdgePanel {...props} edge={{ ...edge, data: { ...edge.data!, label: edge.id } }} />));
    expect(host.querySelector('[data-testid="inspector-field-settings"]')).not.toBeNull();
    expect(errors.mock.calls).toEqual([]);
  } finally {
    await act(() => root.unmount());
    host.remove();
    errors.mockRestore();
    vi.unstubAllGlobals();
  }
});
