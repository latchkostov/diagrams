import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/** One content-addressed directory keeps the icon URL manifest small as the catalogue grows.
 * SVGs still download individually on use; the exported viewer keeps its own subsetted URL module. */
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
          return { name, source: readFileSync(file) };
        });
      const hash = createHash("sha256");
      for (const file of files) hash.update(file.name).update("\0").update(file.source).update("\0");
      const directory = `assets/stencils-${hash.digest("hex").slice(0, 12)}`;
      for (const file of files)
        this.emitFile({ type: "asset", fileName: `${directory}/${file.name}`, source: file.source });
      return `
        const base = import.meta.env.BASE_URL + ${JSON.stringify(`${directory}/`)};
        export const iconUrls = Object.fromEntries(${JSON.stringify(files.map((f) => f.name).join(" "))}
          .split(" ").map(name => ["./icons/" + name, base + name]));
        export function iconUrl(icon) { return iconUrls["./icons/" + icon + ".svg"]; }
      `;
    },
  };
}
