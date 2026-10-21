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
      if (lab) return `export const labMetadata = ${JSON.stringify(metadata)};`;
      // A compact row format keeps this registry within the startup budget.
      // Reconstruct the same public objects once, without changing thumbnail data.
      // diagramThumb rounds coordinates to tenths; integer packing is lossless.
      const accents: string[] = [];
      const packPoints = (points: (number | string)[][]) =>
        points.map((point) =>
          point.map((value, i) => {
            if (i < 4) return Math.round(Number(value) * 10);
            const accent = String(value);
            let index = accents.indexOf(accent);
            if (index < 0) {
              index = accents.length;
              accents.push(accent);
            }
            return index;
          }),
        );
      const rows = Object.entries(metadata).map(([slug, value]) => {
        const { title, description, thumb, shows, simulation } = value as {
          title: string;
          description?: string;
          thumb: ReturnType<typeof diagramThumb>;
          shows: string[];
          simulation?: string;
        };
        return [
          slug,
          title,
          description,
          thumb.w,
          thumb.h,
          packPoints(thumb.nodes),
          packPoints(thumb.groups),
          thumb.edges,
          shows,
          simulation,
        ];
      });
      return `const accents = ${JSON.stringify(accents)}; export const exampleMetadata = Object.fromEntries(${JSON.stringify(rows)}.map(([slug,title,description,w,h,nodes,groups,edges,shows,simulation]) => [slug,{title,...(description === null ? {} : {description}),thumb:{w,h,nodes:nodes.map(p=>p.map((v,i)=>i<4?v/10:accents[v])),groups:groups.map(p=>p.map(v=>v/10)),edges},shows,...(simulation === null ? {} : {simulation})}]));`;
    },
  };
}
