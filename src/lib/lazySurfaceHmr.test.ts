import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { lazySurfaceHmr } from "../../scripts/lazy-surface-hmr";

function transform(code: string, id = "/repo/src/live/lazyFixture.tsx") {
  const hook = lazySurfaceHmr().transform;
  if (typeof hook !== "function") throw new Error("Missing transform");
  return hook.call({} as ThisParameterType<typeof hook>, code, id);
}

it("assigns the defining module's hot context to generic and aliased surface declarations", async () => {
  const source = `import { defineLazySurface as define } from "../lib/lazySurface";
const a = define<{ label: string }>({ id: "live.calls" });
const b = define({ id: "live.threads" });`;
  const output = await transform(source);
  expect(output && typeof output === "object" && output.code).toContain(
    '__ldSurfaceOwner(import.meta.hot, () => define<{ label: string }>({ id: "live.calls" }))',
  );
  expect(output && typeof output === "object" && output.code).toContain(
    '__ldSurfaceOwner(import.meta.hot, () => define({ id: "live.threads" }))',
  );
  expect(lazySurfaceHmr().apply).toBe("serve");
});

it("leaves unrelated functions, explicit owners and unit fixtures alone", async () => {
  expect(
    await transform('import { defineLazySurface } from "another-library"; defineLazySurface({});'),
  ).toBeUndefined();
  const source = 'import { defineLazySurface } from "../lib/lazySurface"; defineLazySurface({}, explicitOwner);';
  const output = await transform(source);
  expect(output && typeof output === "object" && output.code).toContain(source);
  expect(await transform(source, "/repo/src/lib/fixture.test.ts")).toBeUndefined();
});

it("lets Node enumerate surface metadata without Vite's import.meta.env", () => {
  const url = new URL("./lazySurfaces.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const {lazySurfaces} = await import(${JSON.stringify(url)}); if (!lazySurfaces.length) throw new Error("No metadata");`,
    ],
    { encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
