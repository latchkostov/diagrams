// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { state } from "./core";
import { surfaceCatalogs as ensure, usedCatalogs } from "./surfaces";
import { chooseLocale, loadSurfaceCatalogs, setLocale, start } from "./load";

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
it("a surface arriving during a language switch cannot release untranslated content", async () => {
  usedCatalogs.add("tutorials");
  const held = deferred();
  loaders.tutorial.mockReturnValueOnce(held.promise);
  const switching = chooseLocale("de");
  await vi.waitFor(() => expect(loaders.tutorial).toHaveBeenCalled());
  const surface = loadSurfaceCatalogs(["simulation"]);
  held.resolve({ default: { lesson: "Lektion" } });
  await Promise.all([surface, switching]);
  expect(state.c).toEqual({ shell: "Deutsch", lesson: "Lektion", settings: "Einstellungen" });
});
