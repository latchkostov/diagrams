// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let state: typeof import("./core").state;
let ensure: typeof import("./surfaces").surfaceCatalogs;
let usedCatalogs: typeof import("./surfaces").usedCatalogs;
let chooseLocale: typeof import("./load").chooseLocale;
let loadSurfaceCatalogs: typeof import("./load").loadSurfaceCatalogs;
let setLocale: typeof import("./load").setLocale;
let start: typeof import("./load").start;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  ({ state } = await import("./core"));
  ({ surfaceCatalogs: ensure, usedCatalogs } = await import("./surfaces"));
  ({ chooseLocale, loadSurfaceCatalogs, setLocale, start } = await import("./load"));
});

const loaders = vi.hoisted(() => ({ de: vi.fn(), ar: vi.fn(), tutorial: vi.fn() }));
vi.mock("virtual:i18n/catalogs", () => ({
  coreCatalogs: {
    de: async () => ({ default: { shell: "Deutsch" } }),
    ar: async () => ({ default: { shell: "عربي" } }),
  },
  surfaceCatalogs: { de: { simulation: loaders.de, tutorials: loaders.tutorial }, ar: { simulation: loaders.ar } },
  reviewed: [],
}));
const deferred = () => {
  let resolve!: (v: { default: Record<string, string> }) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<{ default: Record<string, string> }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
afterEach(() => {
  usedCatalogs.clear();
  setLocale("en");
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("startup loads only core and a failed surface retries while preserving the shell", async () => {
  vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
  await start();
  expect(state.c).toEqual({ shell: "Deutsch" });
  expect(loaders.de).not.toHaveBeenCalled();
  loaders.de.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ default: { settings: "Einstellungen" } });
  await expect(ensure(["simulation"])).rejects.toThrow("offline");
  expect(state.c).toEqual({ shell: "Deutsch" });
  await ensure(["simulation"]);
  expect(state.c).toEqual({ shell: "Deutsch", settings: "Einstellungen" });
});
it("a surface used in English is ready before switching to Arabic, including RTL", async () => {
  await ensure(["tutorials"]);
  expect(usedCatalogs.has("tutorials")).toBe(true);
  usedCatalogs.clear();
  await ensure(["simulation"]);
  const held = deferred();
  loaders.ar.mockReturnValueOnce(held.promise);
  const switchLanguage = chooseLocale("ar");
  await vi.waitFor(() => expect(loaders.ar).toHaveBeenCalled());
  expect(state.l).toBe("en");
  held.resolve({ default: { settings: "إعدادات" } });
  await switchLanguage;
  expect(document.documentElement.dir).toBe("rtl");
  expect(state.c).toEqual({ shell: "عربي", settings: "إعدادات" });
});
it("waits for a newly used catalog during a language switch", async () => {
  usedCatalogs.add("tutorials");
  const held = deferred();
  loaders.tutorial.mockReturnValueOnce(held.promise);
  const switching = chooseLocale("de");
  await vi.waitFor(() => expect(loaders.tutorial).toHaveBeenCalled());
  const simulation = deferred();
  loaders.de.mockReturnValueOnce(simulation.promise);
  let finished = false;
  void switching.then(() => {
    finished = true;
  });
  const surface = loadSurfaceCatalogs(["simulation"]);
  held.resolve({ default: { lesson: "Lektion" } });
  await vi.waitFor(() => expect(loaders.de).toHaveBeenCalledOnce());
  expect(finished).toBe(false);
  expect(state.l).toBe("en");
  simulation.resolve({ default: { settings: "Einstellungen" } });
  await Promise.all([surface, switching]);
  expect(state.c).toEqual({ shell: "Deutsch", lesson: "Lektion", settings: "Einstellungen" });
});

// R-772d092ba0: a surface waiting on the old language's catalog follows the switch and ignores its obsolete failure.
const outcome = (promise: Promise<unknown>) => {
  const seen: { settled?: "resolved" | "rejected" } = {};
  promise.then(
    () => (seen.settled = "resolved"),
    () => (seen.settled = "rejected"),
  );
  return seen;
};
it("re-targets a surface held on the old language to English, and its later failure changes nothing", async () => {
  vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
  await start();
  const held = deferred();
  loaders.de.mockReturnValueOnce(held.promise);
  const surface = outcome(ensure(["simulation"])!);
  await vi.waitFor(() => expect(loaders.de).toHaveBeenCalledOnce());
  await chooseLocale("en");
  await vi.waitFor(() => expect(surface.settled).toBe("resolved"));
  held.reject(new Error("offline"));
  await new Promise((r) => setTimeout(r, 0));
  expect(surface.settled).toBe("resolved");
  expect(state.l).toBe("en");
});
it("re-targets a held surface to the language a switch commits, with that language's strings", async () => {
  vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
  await start();
  const held = deferred();
  loaders.de.mockReturnValueOnce(held.promise);
  loaders.ar.mockResolvedValueOnce({ default: { settings: "إعدادات" } });
  const surface = outcome(ensure(["simulation"])!);
  await vi.waitFor(() => expect(loaders.de).toHaveBeenCalledOnce());
  await chooseLocale("ar");
  await vi.waitFor(() => expect(surface.settled).toBe("resolved"));
  expect(state.c).toEqual({ shell: "عربي", settings: "إعدادات" });
  const { catalogsReady } = await import("./surfaces");
  expect(catalogsReady(["simulation"])).toBe(true);
  held.resolve({ default: { settings: "Einstellungen" } });
  await new Promise((r) => setTimeout(r, 0));
  expect(state.c).toEqual({ shell: "عربي", settings: "إعدادات" });
});
it("a failure for the language on screen waits for a switch in progress, then follows it", async () => {
  vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
  await start();
  const old = deferred();
  const next = deferred();
  loaders.de.mockReturnValueOnce(old.promise);
  loaders.ar.mockReturnValueOnce(next.promise);
  const surface = outcome(ensure(["simulation"])!);
  await vi.waitFor(() => expect(loaders.de).toHaveBeenCalledOnce());
  const switching = chooseLocale("ar");
  await vi.waitFor(() => expect(loaders.ar).toHaveBeenCalledOnce());
  old.reject(new Error("offline"));
  await new Promise((r) => setTimeout(r, 0));
  expect(surface.settled).toBeUndefined();
  next.resolve({ default: { settings: "إعدادات" } });
  await switching;
  await vi.waitFor(() => expect(surface.settled).toBe("resolved"));
});
it("readiness is per language: switching back needs the bucket in the new catalog", async () => {
  const { catalogsReady } = await import("./surfaces");
  vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
  await start();
  expect(catalogsReady(["simulation"])).toBe(false);
  loaders.de.mockResolvedValue({ default: { settings: "Einstellungen" } });
  await ensure(["simulation"]);
  expect(catalogsReady(["simulation"])).toBe(true);
  expect(catalogsReady(["simulation"], "ar")).toBe(false);
  expect(ensure(["simulation"])).toBeUndefined();
  await chooseLocale("en");
  expect(catalogsReady(["simulation"])).toBe(true);
  await chooseLocale("de");
  expect(catalogsReady(["simulation"])).toBe(true);
  expect(state.c).toEqual({ shell: "Deutsch", settings: "Einstellungen" });
});

it("useSurfaceCatalogs loads, fails for the language on screen, retries, and follows a switch", async () => {
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useSurfaceCatalogs } = await import("./useSurfaceCatalogs");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { languages: ["de"], language: "de" });
  await start();
  const seen: { ready: boolean; failed: boolean; retry(): void }[] = [];
  function Probe() {
    seen.push(useSurfaceCatalogs(["simulation"]));
    return null;
  }
  const root = createRoot(document.createElement("div"));
  loaders.de
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ default: { settings: "Einstellungen" } });
  try {
    await act(async () => root.render(createElement(Probe)));
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ ready: false, failed: true }));
    await act(async () => seen.at(-1)!.retry());
    await vi.waitFor(() => expect(seen.at(-1)).toMatchObject({ ready: true, failed: false }));
    expect(state.c).toEqual({ shell: "Deutsch", settings: "Einstellungen" });
    loaders.ar.mockResolvedValueOnce({ default: { settings: "إعدادات" } });
    await act(async () => void (await chooseLocale("ar")));
    expect(seen.at(-1)).toMatchObject({ ready: true, failed: false });
    expect(state.c).toEqual({ shell: "عربي", settings: "إعدادات" });
  } finally {
    await act(async () => root.unmount());
  }
});
