import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it } from "vitest";
import { stencilIconAssets } from "../../scripts/stencil-icon-assets";

it("keeps cached icon URLs when another glyph is added or edited", async () => {
  const root = mkdtempSync(join(tmpdir(), "stencil-icons-"));
  const stencils = join(root, "src", "stencils");
  const icons = join(stencils, "icons");
  mkdirSync(icons, { recursive: true });
  const input = join(stencils, "iconUrls.ts");
  writeFileSync(input, "export {};");
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const buildIcons = async () => {
    const result = await build({
      configFile: false,
      root,
      base: "/tools/diagrams/",
      plugins: [stencilIconAssets()],
      logLevel: "silent",
      build: { write: false, lib: { entry: input, formats: ["es"] } },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((r) => ("output" in r ? r.output : []));
    const entry = output.find((o) => o.type === "chunk" && o.isEntry)!;
    if (entry.type !== "chunk") throw new Error("missing icon module");
    const module = (await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(entry.code).toString("base64")}`
    )) as {
      iconUrl: (name: string) => string | undefined;
    };
    for (const name of ["one", "two"]) {
      const url = module.iconUrl(name)!;
      expect(url).toMatch(/^\/tools\/diagrams\/assets\//);
      expect(output.some((o) => o.fileName === url.replace("/tools/diagrams/", ""))).toBe(true);
    }
    return module;
  };
  try {
    writeFileSync(join(icons, "one.svg"), svg("<circle r='1'/>"));
    writeFileSync(join(icons, "two.svg"), svg("<circle r='2'/>"));
    const before = await buildIcons();
    writeFileSync(join(icons, "three.svg"), svg("<circle r='3'/>"));
    const added = await buildIcons();
    expect(added.iconUrl("one")).toBe(before.iconUrl("one"));
    expect(added.iconUrl("two")).toBe(before.iconUrl("two"));
    writeFileSync(join(icons, "two.svg"), svg("<rect width='2' height='2'/>"));
    const edited = await buildIcons();
    expect(edited.iconUrl("one")).toBe(before.iconUrl("one"));
    expect(edited.iconUrl("two")).not.toBe(before.iconUrl("two"));
    expect(edited.iconUrl("three")).toBe(added.iconUrl("three"));
    expect(edited.iconUrl("unknown")).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
