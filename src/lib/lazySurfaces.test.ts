import { beforeEach, expect, it, vi } from "vitest";
import type { SurfaceOwner, SurfaceRuntime } from "./lazySurfaces";

beforeEach(() => vi.resetModules());

function owner(data = {}) {
  const cleanups: (() => void)[] = [];
  return {
    data,
    dispose: (fn: () => void) => cleanups.push(fn),
    unload: () => cleanups.forEach((fn) => fn()),
  } satisfies SurfaceOwner & { unload(): void };
}

function surface(active = true) {
  let release!: () => void;
  let loaded = false;
  const held = new Promise<void>((resolve) => (release = resolve));
  const runtime: SurfaceRuntime = {
    id: "live.calls",
    active: () => active,
    ensureLoaded: vi.fn(async () => {
      await held;
      loaded = true;
    }),
    getState: () => (loaded ? "loaded" : "loading"),
  };
  return {
    runtime,
    release,
    deactivate: () => {
      active = false;
    },
  };
}

it("replaces only a hot module's own registration and keeps mounted generations in output readiness", async () => {
  const {
    registerLazySurface: register,
    withLazySurfaceOwner,
    ensureLazySurfacesLoaded,
  } = await import("./lazySurfaces");
  const registerLazySurface = (runtime: SurfaceRuntime, owner: SurfaceOwner) =>
    withLazySurfaceOwner(owner, () => register(runtime));
  const first = owner();
  const old = surface();
  registerLazySurface(old.runtime, first);
  first.unload();
  const replacement = surface(false);
  const second = owner(first.data);
  expect(() => registerLazySurface(replacement.runtime, second)).not.toThrow();
  let ready = false;
  const output = Promise.resolve(ensureLazySurfacesLoaded()).then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(old.runtime.ensureLoaded).toHaveBeenCalledOnce();
  expect(replacement.runtime.ensureLoaded).not.toHaveBeenCalled();
  old.release();
  await output;
  expect(ready).toBe(true);
  old.deactivate();
  // A delayed disposer from the old generation cannot remove its replacement.
  first.unload();
  expect(() => registerLazySurface(surface().runtime, owner())).toThrow("Duplicate lazy surface: live.calls");
  expect(() => registerLazySurface(surface().runtime, second)).toThrow("Duplicate lazy surface: live.calls");
  second.unload();
  expect(() => registerLazySurface(surface(false).runtime, owner())).not.toThrow();
});

it("rechecks the replacement when an already pending export finishes its old chunk", async () => {
  const {
    registerLazySurface: register,
    withLazySurfaceOwner,
    ensureLazySurfacesLoaded,
  } = await import("./lazySurfaces");
  const registerLazySurface = (runtime: SurfaceRuntime, owner: SurfaceOwner) =>
    withLazySurfaceOwner(owner, () => register(runtime));
  const first = owner();
  const old = surface();
  registerLazySurface(old.runtime, first);
  let ready = false;
  const output = Promise.resolve(ensureLazySurfacesLoaded()).then(() => {
    ready = true;
  });
  const replacement = surface();
  registerLazySurface(replacement.runtime, owner(first.data));
  old.deactivate();
  old.release();
  await vi.waitFor(() => expect(replacement.runtime.ensureLoaded).toHaveBeenCalledOnce());
  expect(ready).toBe(false);
  replacement.release();
  await output;
  expect(ready).toBe(true);
});

it("still rejects genuine unowned duplicates", async () => {
  const { registerLazySurface } = await import("./lazySurfaces");
  registerLazySurface(surface(false).runtime);
  expect(() => registerLazySurface(surface(false).runtime)).toThrow("Duplicate lazy surface: live.calls");
});

it("releases a disposed module's registration once its last active consumer unmounts", async () => {
  const { registerLazySurface, withLazySurfaceOwner, ensureLazySurfacesLoaded } = await import("./lazySurfaces");
  const first = owner();
  const old = surface();
  withLazySurfaceOwner(first, () => registerLazySurface(old.runtime));
  first.unload();
  const output = ensureLazySurfacesLoaded();
  expect(old.runtime.ensureLoaded).toHaveBeenCalledOnce();
  old.deactivate();
  const next = owner();
  expect(() => withLazySurfaceOwner(next, () => registerLazySurface(surface(false).runtime))).not.toThrow();
  old.release();
  await output;
  first.unload();
  expect(() => withLazySurfaceOwner(owner(), () => registerLazySurface(surface(false).runtime))).toThrow(
    "Duplicate lazy surface: live.calls",
  );
});
