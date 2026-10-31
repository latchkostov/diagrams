import { afterEach, expect, it, vi } from "vitest";
import { createFileWriter, saveWithPicker, writeHandle, type FileHandle } from "../interop/files";
import { cancelObservedWork, observationPorts } from "../lib/observations";

const context = vi.hoisted(() => {
  const source = { documentId: "sandbox", identity: {} };
  return { source, current: source };
});
vi.mock("../palette/observationSource", () => ({ currentObservationSource: () => context.current }));
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  cancelObservedWork(context.source);
  context.current = context.source;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function handle(close = async () => {}) {
  const stream = { write: vi.fn(async () => {}), close: vi.fn(close), abort: vi.fn(async () => {}) };
  const file: FileHandle = {
    kind: "file",
    name: "public.diagram.json",
    getFile: vi.fn(),
    createWritable: vi.fn(async () => stream),
  };
  return { file, stream };
}
function listen() {
  const listener = vi.fn();
  stops.push(observationPorts.exports.subscribe(listener));
  return listener;
}

it("reports native Save only after the real stream closes successfully", async () => {
  const closed = deferred<undefined>();
  const { file, stream } = handle(() => closed.promise);
  const listener = listen();
  const pending = writeHandle(file, "public bytes");
  await vi.waitFor(() => expect(stream.close).toHaveBeenCalledOnce());
  expect(listener).not.toHaveBeenCalled();
  closed.resolve(undefined);
  await pending;
  expect(listener).toHaveBeenCalledWith({ ...context.source, format: "native", bytes: 12 });
});

it("failed writes never publish a download", async () => {
  const { file, stream } = handle();
  stream.write.mockRejectedValue(new Error("disk full"));
  const listener = listen();
  await expect(writeHandle(file, "public")).rejects.toThrow("disk full");
  expect(stream.close).not.toHaveBeenCalled();
  expect(stream.abort).toHaveBeenCalledOnce();
  expect(listener).not.toHaveBeenCalled();
});

it("Restart/Exit during a native write aborts before commit and publishes nothing", async () => {
  const written = deferred<undefined>();
  const { file, stream } = handle();
  stream.write.mockImplementation(() => written.promise);
  const listener = listen();
  const pending = writeHandle(file, "public");
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(stream.write).toHaveBeenCalledOnce());
  cancelObservedWork(context.source);
  written.resolve(undefined);
  await rejected;
  expect(stream.close).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
});

it("a picker captures ownership before waiting; replacement cannot write A's content as B", async () => {
  const picked = deferred<FileHandle>();
  const { file } = handle();
  vi.stubGlobal("window", { showSaveFilePicker: () => picked.promise });
  const listener = listen();
  const pending = saveWithPicker("A's public content", "public.diagram.json");
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  context.current = { documentId: "other", identity: {} };
  picked.resolve(file);
  await rejected;
  expect(file.createWritable).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
});

it("cancelling a system picker or a delayed download never publishes success", async () => {
  vi.stubGlobal("window", {
    showSaveFilePicker: async () => {
      throw new DOMException("Cancelled", "AbortError");
    },
  });
  const listener = listen();
  expect(await saveWithPicker("public", "public.diagram.json")).toBeUndefined();
  const writer = createFileWriter();
  cancelObservedWork(context.source);
  expect(() => writer.text("public", "public.svg", "image/svg+xml")).toThrow();
  writer.finish();
  expect(listener).not.toHaveBeenCalled();
});
