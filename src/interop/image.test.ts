import { expect, it, vi } from "vitest";
import { renderDiagramImage } from "./image";
import { whenEdgeGeometryReady } from "../canvas/edges/readiness";
vi.mock("../canvas/edges/readiness", () => ({ whenEdgeGeometryReady: vi.fn() }));

it("does not measure export bounds until pending saved-route geometry is ready", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(whenEdgeGeometryReady).mockReturnValue(held);
  const measure = vi.fn(() => []);
  vi.stubGlobal("document", { querySelector: () => ({ querySelectorAll: measure }) });
  try {
    const rendering = renderDiagramImage("svg").catch((error: unknown) => error);
    await Promise.resolve();
    expect(whenEdgeGeometryReady).toHaveBeenCalledTimes(1);
    expect(measure).not.toHaveBeenCalled();
    release();
    expect(await rendering).toEqual(new Error("This diagram is empty, so there's nothing to export."));
    expect(measure).toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
