/* eslint-disable local/no-literal-ui-text -- Diagram labels in these fixtures are test inputs, not UI copy. */
import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { mobileApi } from "./catalog/mobileApi";
import { createTutorialStart, loadTutorialStart, tutorialStartMachine } from "./start";
import { machinePaths } from "../lib/machine";
import { nextTutorial, saveProgress } from "./progress";

const { loadExample } = vi.hoisted(() => ({ loadExample: vi.fn() }));
vi.mock("../examples", () => ({ loadExample }));

it("loads an example into a fresh, titled sandbox without changing its cached document", async () => {
  const source: DiagramFile = {
    format: "diagrams/v1",
    title: "Original",
    nodes: [{ id: "a", label: "Original", stencil: "generic.service", x: 0, y: 0 }],
    edges: [],
  };
  loadExample.mockResolvedValue(source);
  const tutorial = { ...mobileApi, start: { example: "retry-storm", simulation: "demo" } };
  const copy = await loadTutorialStart(tutorial);
  expect(loadExample).toHaveBeenCalledWith("retry-storm");
  expect(copy.title).toBe(tutorial.title());
  copy.nodes[0].label = "Changed";
  expect(source.nodes[0].label).toBe("Original");
});

it("loads factories too and surfaces example failures instead of opening an empty sandbox", async () => {
  expect((await loadTutorialStart(mobileApi)).nodes).toEqual([]);
  loadExample.mockRejectedValue(new Error("unavailable"));
  await expect(loadTutorialStart({ ...mobileApi, start: { example: "missing" } })).rejects.toThrow("unavailable");
});

it("offers unfinished lessons in chapter order, continuing into the next chapter", () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  try {
    const completed = { ...mobileApi, id: "completed" },
      next = { ...mobileApi, id: "next" };
    const elsewhere = { ...mobileApi, id: "elsewhere", track: "simulation" as const };
    saveProgress(completed, 0, true);
    expect(nextTutorial(mobileApi, [mobileApi, elsewhere, completed, next])).toBe(next);
    saveProgress(next, 0, true);
    expect(nextTutorial(mobileApi, [mobileApi, elsewhere, completed, next])).toBe(elsewhere);
    saveProgress(elsewhere, 0, true);
    expect(nextTutorial(mobileApi, [mobileApi, elsewhere, completed, next])).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("retries a failed example load and ignores completions after cancellation", async () => {
  let resolve: (diagram: DiagramFile) => void = () => {};
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockImplementation(
      () =>
        new Promise<DiagramFile>((yes) => {
          resolve = yes;
        }),
    );
  const loader = createTutorialStart(mobileApi, load);
  const off = loader.connect();
  await Promise.resolve();
  expect(loader.getSnapshot().value).toBe("failed");
  loader.retry();
  expect(loader.getSnapshot().value).toBe("loading");
  off();
  resolve(mobileApi.start());
  await Promise.resolve();
  expect(loader.getSnapshot().value).toBe("idle");
  const stop = loader.connect();
  resolve(mobileApi.start());
  await Promise.resolve();
  expect(loader.getSnapshot().value).toBe("ready");
  expect(load).toHaveBeenCalledTimes(3);
  stop();
});

it("keeps start-machine paths valid and requires a diagram in ready", () => {
  for (const path of machinePaths(tutorialStartMachine, { maxDepth: 4 })) {
    expect(path.state.request).toBeGreaterThanOrEqual(0);
    if (path.state.value === "ready") expect(path.state.diagram).not.toBeNull();
  }
});

it("ignores an older request completing after Retry has started a replacement", async () => {
  const requests: ((diagram: DiagramFile) => void)[] = [];
  const loader = createTutorialStart(
    mobileApi,
    () =>
      new Promise<DiagramFile>((resolve) => {
        requests.push(resolve);
      }),
  );
  const stop = loader.connect();
  loader.retry();
  requests[0]({ ...mobileApi.start(), title: "Old" });
  await Promise.resolve();
  expect(loader.getSnapshot().value).toBe("loading");
  requests[1]({ ...mobileApi.start(), title: "Current" });
  await Promise.resolve();
  expect(loader.getSnapshot().diagram?.title).toBe("Current");
  stop();
});
