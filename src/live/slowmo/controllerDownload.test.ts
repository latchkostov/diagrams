import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../../model/types";
import { LiveController } from "../controller";
import { createSlowMotionView, type SlowMotionOptions } from "./controller";
import { loadSlowScript } from "./scriptChunk";

vi.mock("./scriptChunk", () => ({
  loadSlowScript: vi.fn(() => Promise.resolve({})),
  slowScript: () => undefined,
  slowPainter: () => undefined,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("does not download replay code while ordinary Live sessions become idle or unmount", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const diagram = JSON.parse(readFileSync("src/examples/kafka-order-pipeline.json", "utf8")) as DiagramFile;
  const controller = new LiveController(diagram);
  const store = { getState: () => ({ domNode: null }) } as unknown as SlowMotionOptions["store"];
  const camera = { slowmo: () => () => {}, dispatch: vi.fn() } as unknown as SlowMotionOptions["camera"];
  try {
    for (let i = 0; i < 12; i++) {
      const view = createSlowMotionView({
        controller,
        store,
        camera,
        presenting: false,
        reducedMotion: false,
        panelOpen: false,
        capturing: false,
      });
      const disconnect = view.connect();
      vi.runOnlyPendingTimers();
      disconnect();
      vi.runOnlyPendingTimers();
    }
    expect(loadSlowScript).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});
