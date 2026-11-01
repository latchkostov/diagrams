import { afterEach, expect, it, vi } from "vitest";
import { copyAiContext } from "../ai/ui/copyContext";
import { copyText } from "../interop/ui/copyText";
import { observationPorts } from "../lib/observations";
import { paletteHost } from "../palette/host";
const context = vi.hoisted(() => ({ source: { documentId: "public-practice", identity: {} } }));
vi.mock("../palette/observationSource", () => ({ currentObservationSource: () => context.source }));
vi.mock("../interop/ui/copyText", () => ({ copyText: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it("records selected context only after a successful local clipboard write", async () => {
  vi.spyOn(paletteHost, "get").mockReturnValue({
    canvas: { editor: { getSelection: () => ({ nodeIds: ["api"], edgeIds: [], groupIds: [] }) } },
  } as unknown as ReturnType<typeof paletteHost.get>);
  const seen = vi.fn();
  const off = observationPorts.ai.subscribe(seen);
  try {
    vi.mocked(copyText).mockResolvedValue(false);
    expect(await copyAiContext("public context")).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    vi.mocked(copyText).mockResolvedValue(true);
    expect(await copyAiContext("public context")).toBe(true);
    expect(seen).toHaveBeenCalledWith({ ...context.source, kind: "context", changed: ["api"], copiedBytes: 14 });
  } finally {
    off();
  }
});

it("cancellation suppresses a delayed clipboard result", async () => {
  let resolve!: (ok: boolean) => void;
  vi.mocked(copyText).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const seen = vi.fn();
  const off = observationPorts.ai.subscribe(seen);
  const controller = new AbortController();
  try {
    const pending = copyAiContext("public context", controller.signal);
    controller.abort();
    resolve(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).not.toHaveBeenCalled();
  } finally {
    off();
  }
});
