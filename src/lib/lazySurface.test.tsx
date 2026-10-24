// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { machinePaths } from "./machine";
import type { InteractionController } from "../canvas/interaction/controller";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetModules();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

it("shares a held request, preserves focus, and reports one failure across multiple consumers", async () => {
  const { defineLazySurface } = await import("./lazySurface");
  const { toast } = await import("../interop/ui/toast");
  const first = deferred<() => React.ReactNode>();
  const load = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(() => <b data-testid="arrived" />);
  const Surface = defineLazySurface({
    id: "live.timeline",
    load,
    placeholder: { size: { width: 120 }, testId: "pending" },
    focus: {},
    export: "skip",
    retryToast: true,
  });
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  await act(() =>
    root.render(
      <>
        <Surface />
        <Surface />
      </>,
    ),
  );
  expect(load).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(input);
  expect(host.querySelectorAll('[data-testid="pending"]')).toHaveLength(2);
  expect(Surface.ensureLoaded()).toBe(Surface.ensureLoaded());
  await act(async () => {
    first.reject(new Error("offline"));
  });
  const failure = toast.current;
  expect(host.querySelector('[data-testid="pending"]')?.getAttribute("aria-busy")).toBe("false");
  expect(failure?.action?.testId).toBe("lazy-load-retry");
  await act(() => root.render(<Surface />));
  expect(toast.current?.id).toBe(failure?.id);
  await act(() => {
    failure!.action!.run();
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-testid="arrived"]')).not.toBeNull();
  expect(document.activeElement).toBe(input);
  expect(Surface.getSnapshot().value).toBe("loaded");
  input.remove();
});

it("keeps preload failure silent, retries on demand and does not remount after a late completion", async () => {
  const { defineLazySurface } = await import("./lazySurface");
  const { toast } = await import("../interop/ui/toast");
  const next = deferred<() => React.ReactNode>();
  const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(next.promise);
  const Surface = defineLazySurface({
    id: "live.timeline",
    load,
    placeholder: { size: {}, testId: "pending" },
    focus: {},
    export: "skip",
    retryToast: true,
  });
  await expect(Surface.ensureLoaded()).rejects.toThrow("offline");
  expect(toast.current).toBeNull();
  await act(() => root.render(<Surface />));
  expect(toast.current).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
  await act(() => root.render(null));
  await act(() => next.resolve(() => <b>ready</b>));
  expect(host.childNodes).toHaveLength(0);
  expect(Surface.getSnapshot().value).toBe("loaded");
});

it("reopening after a dismissed failure toast starts a fresh shared attempt", async () => {
  const { defineLazySurface } = await import("./lazySurface");
  const { toast } = await import("../interop/ui/toast");
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(() => <b data-testid="reopened" />);
  const Surface = defineLazySurface({
    id: "live.timeline",
    load,
    placeholder: { size: {}, testId: "pending" },
    focus: {},
    export: "skip",
    retryToast: true,
  });
  await act(() => root.render(<Surface />));
  expect(toast.current?.action?.testId).toBe("lazy-load-retry");
  toast.dismiss();
  await act(() => root.render(null));
  await act(() =>
    root.render(
      <>
        <Surface />
        <Surface />
      </>,
    ),
  );
  expect(load).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll('[data-testid="reopened"]')).toHaveLength(2);
});

it("the surviving toast retries every active consumer of a shared failed chunk", async () => {
  const { defineLazySurface } = await import("./lazySurface");
  const { loadOnce } = await import("./lazyLoad");
  const { toast } = await import("../interop/ui/toast");
  const shared = loadOnce<() => React.ReactNode>(
    vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(() => <b data-testid="shared" />),
  );
  const Calls = defineLazySurface({
    id: "live.calls",
    load: shared,
    placeholder: { size: {}, testId: "calls" },
    focus: {},
    export: "await",
    retryToast: true,
  });
  const Threads = defineLazySurface({
    id: "live.threads",
    load: shared,
    placeholder: { size: {}, testId: "threads" },
    focus: {},
    export: "await",
    retryToast: true,
  });
  await act(() =>
    root.render(
      <>
        <Calls />
        <Threads />
      </>,
    ),
  );
  expect(Calls.getSnapshot().value).toBe("failed");
  expect(Threads.getSnapshot().value).toBe("failed");
  await act(() => toast.current!.action!.run());
  expect(host.querySelectorAll('[data-testid="shared"]')).toHaveLength(2);
});

it("Retry dispatches focus through the declared panel root", async () => {
  const { defineLazySurface } = await import("./lazySurface");
  const { InteractionContext } = await import("../canvas/interaction/useInteraction");
  const { toast } = await import("../interop/ui/toast");
  const dispatch = vi.fn();
  const controller = { dispatch, rendered: vi.fn() } as unknown as InteractionController;
  const Surface = defineLazySurface({
    id: "live.timeline",
    load: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(() => <b />),
    placeholder: { size: {}, testId: "pending" },
    focus: { panel: "live-controls", restoreTo: "live-play" },
    export: "skip",
    retryToast: true,
  });
  await act(() =>
    root.render(
      <InteractionContext.Provider value={controller}>
        <Surface />
      </InteractionContext.Provider>,
    ),
  );
  await act(() => toast.current!.action!.run());
  expect(dispatch).toHaveBeenCalledWith({ type: "panel.field", panel: "live-controls", field: "live-play" });
});

it("awaits active output surfaces, discovers children, skips UI and propagates load failure", async () => {
  const frame = vi.fn(() => {
    throw new Error("Readiness must not depend on a running animation clock");
  });
  vi.stubGlobal("requestAnimationFrame", frame);
  const { registerLazySurface, ensureLazySurfacesLoaded } = await import("./lazySurfaces");
  const held = deferred<undefined>();
  const child = vi.fn().mockResolvedValue(undefined);
  const skip = vi.fn();
  let parentLoaded = false;
  registerLazySurface({ id: "live.timeline", active: () => true, ensureLoaded: skip, getState: () => "idle" });
  registerLazySurface({ id: "live.calls", active: () => false, ensureLoaded: skip, getState: () => "idle" });
  registerLazySurface({
    id: "live.session",
    active: () => true,
    getState: () => (parentLoaded ? "loaded" : "loading"),
    ensureLoaded: () =>
      held.promise.then(() => {
        parentLoaded = true;
        if (!child.mock.calls.length)
          registerLazySurface({
            id: "live.threads",
            active: () => true,
            ensureLoaded: child,
            getState: () => (child.mock.calls.length ? "loaded" : "idle"),
          });
      }),
  });
  let done = false;
  const ready = Promise.resolve(ensureLazySurfacesLoaded()).then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(skip).not.toHaveBeenCalled();
  held.resolve(undefined);
  await ready;
  expect(child).toHaveBeenCalledTimes(1);
  expect(ensureLazySurfacesLoaded()).toBeUndefined();
  expect(frame).not.toHaveBeenCalled();
  registerLazySurface({
    id: "live.note",
    active: () => true,
    ensureLoaded: () => Promise.reject(new Error("offline")),
    getState: () => "failed",
  });
  await expect(ensureLazySurfacesLoaded()).rejects.toThrow("offline");
});

it("explores failure, retry and success paths and rejects late lifecycle events", async () => {
  const { lazySurfaceMachine } = await import("./lazySurface");
  const paths = machinePaths(lazySurfaceMachine, { maxDepth: 4 });
  expect(new Set(paths.map((p) => p.state.value))).toEqual(new Set(lazySurfaceMachine.states));
  expect(paths.some((p) => p.events.map((e) => e.type).join() === "load,reject,retry,resolve")).toBe(true);
  expect(paths.filter((p) => p.state.value === "loaded").every((p) => p.events.at(-1)?.type === "resolve")).toBe(true);
});
