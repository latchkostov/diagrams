// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createSequenceExporter } from "./sequenceExport";
import { cancelObservedWork, observationPorts } from "../lib/observations";
const context = vi.hoisted(() => ({ source: { documentId: "sandbox", identity: {} } }));
vi.mock("../palette/observationSource", () => ({ currentObservationSource: () => context.source }));
afterEach(() => {
  cancelObservedWork(context.source);
  vi.restoreAllMocks();
});
function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
it("publishes the actual successful bytes with the trace identity, and rejects failed writes", async () => {
  const exporter = createSequenceExporter(17);
  const listener = vi.fn();
  const off = observationPorts.sequenceExport.subscribe(listener);
  try {
    expect(
      await exporter.run("svg", async () => {
        throw new Error("Download blocked");
      }),
    ).toEqual({ status: "failure" });
    expect(listener).not.toHaveBeenCalled();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sequence");
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const bytes = new Blob(["<svg>journey-17</svg>"], { type: "image/svg+xml" });
    expect(
      await exporter.run("svg", async (writer) => {
        writer.blob(bytes, "journey.svg");
        return bytes.size;
      }),
    ).toEqual({ status: "success", bytes: bytes.size });
    expect(download).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      ...context.source,
      traceId: 17,
      format: "svg",
      bytes: bytes.size,
    });
  } finally {
    off();
    exporter.cancel();
  }
});
for (const reason of ["newer action", "close", "Restart", "Exit"])
  it(`invalidates pending conversion on ${reason} and never publishes late success`, async () => {
    const exporter = createSequenceExporter(17);
    const wait = held();
    const written = vi.fn();
    const listener = vi.fn();
    const off = observationPorts.sequenceExport.subscribe(listener);
    try {
      const pending = exporter.run("png", async (_writer, check) => {
        await wait.promise;
        check();
        written();
        return 12;
      });
      if (reason === "newer action")
        expect(await exporter.run("svg", async () => 20)).toEqual({ status: "success", bytes: 20 });
      else if (reason === "close") exporter.cancel();
      else cancelObservedWork(context.source);
      wait.release();
      expect(await pending).toEqual({ status: "cancelled" });
      expect(written).not.toHaveBeenCalled();
      expect(listener).toHaveBeenCalledTimes(reason === "newer action" ? 1 : 0);
      if (reason === "close") {
        expect(
          await exporter.run("svg", async () => {
            written();
            return 20;
          }),
        ).toEqual({ status: "cancelled" });
        expect(written).not.toHaveBeenCalled();
      }
    } finally {
      off();
      exporter.cancel();
    }
  });
