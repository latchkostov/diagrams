import { expect, it } from "vitest";
import en from "./en";
import {
  APP_ENTRIES,
  formatViolations,
  readModule,
  readSources,
  surfaceKeyViolations,
  type SourceModule,
} from "../../scripts/i18n-surfaces";
import { catalogBucket, lintSurfaceCatalogs } from "../../scripts/i18n-plugin";

// The build's surface check (scripts/i18n-surfaces.ts): no module can render a key that is neither in core nor in a
// catalog every path to it declares. Builds and `pnpm i18n check` run it; this keeps it honest.

const bucketOf = (key: string) => (key in en ? catalogBucket(key) : undefined);

it("finds no key a surface can render before its catalog is ready, across the app", () => {
  const violations = surfaceKeyViolations(readSources(process.cwd()), APP_ENTRIES, bucketOf);
  expect(formatViolations(violations)).toBe("");
  expect(() => lintSurfaceCatalogs()).not.toThrow();
});

// R-5361b25fac: planning controls render "Advanced", and planning waits only for the simulation catalog.
it("keeps labels shared by planning, inspector and Live controls in core", () => {
  const modules = readSources(process.cwd());
  const planning = [...modules].filter(
    ([file, m]) => file.startsWith("src/planning/") && m.keys.includes("ai.advanced"),
  );
  expect(planning.length).toBeGreaterThan(0);
  expect(catalogBucket("ai.advanced")).toBe("core");
  expect(modules.get("src/planning/ui.ts")?.declares).toEqual(["simulation"]);
});

const graph = (modules: Record<string, Partial<SourceModule>>) =>
  new Map(
    Object.entries(modules).map(([file, m]) => [file, { keys: [], declares: [], imports: [], dynamic: [], ...m }]),
  );
const buckets: Record<string, string> = { "shell.open": "core", "sim.rate": "simulation", "ai.advanced": "ai" };

it("allows a key under its surface's declaration, through static and dynamic imports", () => {
  const modules = graph({
    main: { dynamic: ["surface"] },
    surface: { declares: ["simulation"], imports: ["fields"], keys: ["shell.open"] },
    fields: { dynamic: ["more"], keys: ["sim.rate"] },
    more: { keys: ["sim.rate"] },
  });
  expect(surfaceKeyViolations(modules, ["main"], (k) => buckets[k])).toEqual([]);
});

it("rejects a key from another surface's catalog, naming the path that lacks it", () => {
  const modules = graph({
    main: { dynamic: ["planning"] },
    planning: { declares: ["simulation"], imports: ["fields"] },
    fields: { keys: ["sim.rate", "ai.advanced"] },
  });
  expect(surfaceKeyViolations(modules, ["main"], (k) => buckets[k])).toEqual([
    { file: "fields", key: "ai.advanced", bucket: "ai", ready: ["simulation"], via: ["main", "planning", "fields"] },
  ]);
});

it("guarantees only what every path declares: a shared module reached from startup gets core", () => {
  const modules = graph({
    main: { imports: ["menu"], dynamic: ["library"] },
    library: { declares: ["simulation"], imports: ["lookup"] },
    menu: { imports: ["lookup"] },
    lookup: { keys: ["sim.rate"] },
  });
  const [violation] = surfaceKeyViolations(modules, ["main"], (k) => buckets[k]);
  expect(violation).toMatchObject({ file: "lookup", ready: [], via: ["main", "menu", "lookup"] });
  modules.get("menu")!.declares = ["simulation"];
  expect(surfaceKeyViolations(modules, ["main"], (k) => buckets[k])).toEqual([]);
});

it("reads keys, literal declarations and runtime imports, not types or comments", () => {
  const files = new Set(["src/a/b.ts", "src/a/c.tsx", "src/a/d/index.ts", "src/a/e.ts", "src/a/f.ts"]);
  const m = readModule(
    "src/a/b.ts",
    [
      'import { t } from "../i18n";',
      'import type { X } from "./e";',
      'import { type Y, type Z } from "./f";',
      'import { value, type W } from "./c";',
      'export { thing } from "./d";',
      '// import { gone } from "./e"; t("comment.key")',
      'const later = () => import("./f");',
      'await surfaceCatalogs(["simulation", "ai"]);',
      'useSurfaceCatalogs(["stencils"], open);',
      't("real.key"); msg("other.key"); tRich("rich.key", {});',
    ].join("\n"),
    (file) => files.has(file),
  );
  expect(m).toEqual({
    keys: ["real.key", "other.key", "rich.key"],
    declares: ["simulation", "ai", "stencils"],
    imports: ["src/a/c.tsx", "src/a/d/index.ts"],
    dynamic: ["src/a/f.ts"],
  });
});
