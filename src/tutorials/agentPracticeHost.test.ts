import { afterEach, expect, it, vi } from "vitest";
import { createAgentPracticeHost } from "./agentPracticeHost";
import { editorHarness } from "../test/editorHarness";
import { paletteHost } from "../palette/host";

afterEach(() => vi.restoreAllMocks());
const editor = () => editorHarness({ format: "diagrams/v1", title: "", nodes: [], edges: [] }).api;
const fixture = () => ({ resetAgentPractice: vi.fn(), agentPractice: vi.fn() });

it("retries failed initialization and lets the mounted host own conversation reset", async () => {
  const module = fixture();
  const load = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(module);
  const host = createAgentPracticeHost("practice", load);
  const ed = editor();
  vi.spyOn(paletteHost, "get").mockReturnValue({
    canvas: { documentId: "practice", editor: ed, live: false, focusNode: vi.fn(), addStencil: vi.fn() },
    live: null,
    session: null,
    pendingRun: null,
  });
  await expect(host.run("add", ed, new AbortController().signal)).rejects.toThrow("Offline");
  await host.run("add", ed, new AbortController().signal);
  await host.run("rename", ed, new AbortController().signal);
  expect(load).toHaveBeenCalledTimes(2);
  expect(module.resetAgentPractice).toHaveBeenCalledExactlyOnceWith("practice");
  expect(module.agentPractice.mock.calls.map((call) => call[2])).toEqual(["add", "rename"]);
  host.reset();
  expect(module.resetAgentPractice).toHaveBeenCalledTimes(2);
});

it("reset during pending initialization suppresses late conversation changes and actions", async () => {
  const module = fixture();
  let release!: (value: typeof module) => void;
  const load = vi.fn(
    () =>
      new Promise<typeof module>((resolve) => {
        release = resolve;
      }),
  );
  const host = createAgentPracticeHost("practice", load);
  const pending = host.run("add", editor(), new AbortController().signal);
  host.reset();
  release(module);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(module.resetAgentPractice).not.toHaveBeenCalled();
  expect(module.agentPractice).not.toHaveBeenCalled();
});

it("a mounted restart initializes again even if the first download was pending", async () => {
  const module = fixture();
  let release!: (value: typeof module) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(module);
  const host = createAgentPracticeHost("practice", load);
  const off = host.connect();
  host.reset();
  await vi.waitFor(() => expect(module.resetAgentPractice).toHaveBeenCalledOnce());
  release(module);
  await vi.dynamicImportSettled();
  expect(load).toHaveBeenCalledTimes(2);
  expect(module.resetAgentPractice).toHaveBeenCalledOnce();
  off();
  expect(load).toHaveBeenCalledTimes(2);
  expect(module.resetAgentPractice).toHaveBeenCalledTimes(2);
});
