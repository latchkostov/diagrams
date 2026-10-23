import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/** Per-icon content hashes preserve cached URLs when other glyphs change. The compact name/hash table
 * keeps the manifest small; the exported viewer keeps its own subsetted URL module. */
export function stencilIconAssets(): Plugin {
  return {
    name: "stencil-icon-assets",
    apply: "build",
    enforce: "pre",
    transform(_code, id) {
      if (!/[/\\]src[/\\]stencils[/\\]iconUrls\.ts$/.test(id)) return;
      const dir = join(dirname(id), "icons");
      const files = readdirSync(dir)
        .filter((name) => name.endsWith(".svg"))
        .sort()
        .map((name) => {
          const file = join(dir, name);
          this.addWatchFile(file);
          const source = readFileSync(file);
          const hash = createHash("sha256").update(source).digest("base64url").slice(0, 8);
          return { name: name.slice(0, -4), source, hash };
        });
      for (const file of files)
        this.emitFile({
          type: "asset",
          fileName: `assets/${file.hash}.svg`,
          source: file.source,
        });
      return `
        const hashes = ${JSON.stringify(files.map((f) => f.hash).join(""))}.match(/.{8}/g);
        export const iconUrls = {};
        ${JSON.stringify(files.map((f) => f.name).join(" "))}.split(" ").forEach((name, i) => {
          iconUrls["./icons/" + name + ".svg"] = import.meta.env.BASE_URL + "assets/" + hashes[i] + ".svg";
        });
        export function iconUrl(icon) { return iconUrls["./icons/" + icon + ".svg"]; }
      `;
    },
  };
}
