import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";
import type { DiagramFile } from "../src/model/types";
import { exampleShows } from "./example-shows";
import { diagramThumb } from "../src/lib/thumbnail";

/** Generate small public registries without importing any diagram into the entry graph. */
export function exampleMetadataPlugin(): Plugin {
  return {
    name: "example-metadata",
    enforce: "pre",
    transform(_code, id) {
      const normalized = id.replaceAll("\\", "/");
      const lab = normalized.endsWith("/src/examples/labMetadata.ts");
      if (!lab && !normalized.endsWith("/src/examples/metadata.ts")) return;
      const dir = dirname(id);
      const metadata = Object.fromEntries(
        readdirSync(dir)
          .filter((name) => name.endsWith(".json"))
          .sort()
          .map((name) => {
            const path = resolve(dir, name);
            this.addWatchFile(path);
            const d = JSON.parse(readFileSync(path, "utf8")) as DiagramFile;
            return [
              name.slice(0, -".json".length),
              lab
                ? (d.simulations ?? []).map((s) => ({
                    id: s.id,
                    title: s.title,
                    description: s.description,
                    deadLetter: (s.expectations ?? []).some(
                      (x) => "node" in x.metric && x.metric.field === "deadLettered" && (x.op === ">" || x.op === ">="),
                    ),
                  }))
                : {
                    title: d.title,
                    description: d.description,
                    thumb: diagramThumb(d),
                    shows: exampleShows(d),
                    simulation: d.simulations?.[0]?.id,
                  },
            ];
          }),
      );
      return `export const ${lab ? "labMetadata" : "exampleMetadata"} = ${JSON.stringify(metadata)};`;
    },
  };
}
