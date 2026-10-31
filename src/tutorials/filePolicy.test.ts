/* eslint-disable local/no-literal-ui-text -- Invented fixture labels are test input. */
import { expect, it, vi } from "vitest";
import { createPracticeImport, createPracticePrivacy, tutorialFilePolicy } from "./filePolicy";
import type { DiagramFile } from "../model/types";
import { beginObservedWork, cancelObservedWork } from "../lib/observations";

const diagram: DiagramFile = { format: "diagrams/v1", title: "Public status", nodes: [], edges: [] };
it("only the explicit library lesson copy can write ownership", () => {
  const copy = vi.fn((_diagram: DiagramFile) => "owned-copy");
  const replace = vi.fn();
  for (const lesson of ["workbench-tour", "mobile-api", "import-and-review"])
    expect(tutorialFilePolicy(lesson, { copy, replace }).saveCopy(diagram)).toBeUndefined();
  expect(copy).not.toHaveBeenCalled();
  expect(tutorialFilePolicy("library-reuse", { copy, replace }).saveCopy(diagram)).toBe("owned-copy");
  expect(copy).toHaveBeenCalledExactlyOnceWith(diagram);
  expect(copy.mock.calls[0][0]).not.toBe(diagram);
});

it("failed explicit copies do not return an owned identity or mutate practice content", () => {
  const before = structuredClone(diagram);
  const policy = tutorialFilePolicy("library-reuse", {
    replace: vi.fn(),
    copy: () => {
      throw new Error("Storage full");
    },
  });
  expect(() => policy.saveCopy(diagram)).toThrow("Storage full");
  expect(diagram).toEqual(before);
});

it("unavailable and disconnected import controllers reject into Retry, and aborted work cannot finish", async () => {
  const practice = createPracticeImport();
  const operation = new AbortController();
  await expect(practice.run(operation.signal)).rejects.toThrow("unavailable");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const apply = vi.fn();
  const off = practice.connect(async (signal) => {
    await held;
    signal.throwIfAborted();
    apply();
    return { status: "success" };
  });
  const pending = practice.run(operation.signal);
  operation.abort();
  release();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(apply).not.toHaveBeenCalled();
  off();
  await expect(practice.run(new AbortController().signal)).rejects.toThrow("unavailable");
});
it("imports have an opt-in sandbox destination and never bind a file handle", () => {
  const ports = { copy: vi.fn(() => "owned"), replace: vi.fn() };
  const target = { providerId: "device", ref: {}, name: "public.diagram.json" };
  expect(tutorialFilePolicy("mobile-api", ports).import(diagram, target)).toBeUndefined();
  expect(ports.replace).not.toHaveBeenCalled();
  expect(tutorialFilePolicy("import-and-review", ports).import(diagram, target)).toBe("tutorial");
  expect(ports.replace).toHaveBeenCalledExactlyOnceWith(diagram);
  expect(ports.copy).not.toHaveBeenCalled();
});

it("an accepted replacement cancels delayed work from the previous practice content", () => {
  const source = { documentId: "practice", identity: {} };
  const oldWork = beginObservedWork(source);
  const otherWork = beginObservedWork({ documentId: "other", identity: {} });
  const replace = vi.fn(() => expect(oldWork.signal.aborted).toBe(true));
  tutorialFilePolicy("import-and-review", { replace, copy: vi.fn(), cancel: () => cancelObservedWork(source) }).import(
    diagram,
  );
  expect(replace).toHaveBeenCalledOnce();
  expect(otherWork.signal.aborted).toBe(false);
  oldWork.finish();
  otherWork.finish();
});

it("the practice bridge propagates failed and cancelled interop outcomes into recovery", async () => {
  const practice = createPracticeImport();
  for (const status of ["failure", "cancelled"] as const) {
    const off = practice.connect(async () => ({ status }));
    await expect(practice.run(new AbortController().signal)).rejects.toThrow(
      status === "failure" ? "Practice import failed" : "Practice import cancelled",
    );
    off();
  }
  practice.connect(async () => ({ status: "success" }));
  await expect(practice.run(new AbortController().signal)).resolves.toBeUndefined();
});

it("practice privacy publishes stable in-memory flags and dies with its session", () => {
  const privacy = createPracticePrivacy();
  const listener = vi.fn();
  const off = privacy.subscribe(listener);
  const before = privacy.get();
  expect(before).toEqual({ private: false });
  privacy.setPrivate(true);
  expect(privacy.get()).toEqual({ private: true });
  expect(privacy.get()).not.toBe(before);
  expect(privacy.get()).toBe(privacy.get());
  privacy.setPrivate(true);
  expect(listener).toHaveBeenCalledOnce();
  off();
  privacy.setPrivate(false);
  expect(listener).toHaveBeenCalledOnce();
  expect(createPracticePrivacy().get()).toEqual({ private: false });
});
