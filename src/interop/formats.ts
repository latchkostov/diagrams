import type { DiagramFile } from "../model/types";
import { LIMITS, parseNative, tooLargeMessage, validateDiagram } from "./native";
import type { DrawioDocument } from "./drawio/read";
import type { ImportGraph, ImportReport } from "./infra/graph";
import { looksLikeDrawio, looksLikeMermaid, sniffInfra } from "./sniff";
import { loadOnce } from "../lib/lazyLoad";

// One entry point for "here is some text (and maybe a file name): what is it, and what diagram
// does it hold?" Used by Open file, drag-and-drop, paste and Google Drive. The draw.io and Mermaid
// converters load when a file needs them (or when the File menu opens: preloadFormats), and so do the
// infrastructure importers (docker-compose, Kubernetes, AsyncAPI, Terraform) with their YAML reader.

const drawioReader = loadOnce(() => import("./drawio/read"));
const mermaidReader = loadOnce(() => import("./mermaid/read"));
const infraReader = loadOnce(() => import("./infra/pipeline"));
export const drawioWriter = loadOnce(() => import("./drawio/write"));
export const mermaidWriter = loadOnce(() => import("./mermaid/write"));

/** Warms the converters, so an import or export that follows doesn't wait for them. */
export function preloadFormats() {
  for (const load of [drawioReader, mermaidReader, drawioWriter, mermaidWriter, infraReader])
    void load().catch(() => {});
}

export type FormatId = "native" | "drawio" | "mermaid" | "compose" | "asyncapi" | "kubernetes" | "terraform";

export const FORMAT_LABEL: Record<FormatId, string> = {
  native: "Live Diagrams file",
  drawio: "draw.io diagram",
  mermaid: "Mermaid flowchart",
  compose: "docker-compose file",
  asyncapi: "AsyncAPI document",
  kubernetes: "Kubernetes manifests",
  terraform: "Terraform plan or state",
};

/** File-picker accept list. */
export const OPEN_ACCEPT =
  ".json,.diagram.json,.drawio,.xml,.mmd,.mermaid,.svg,.yaml,.yml,.env,.tf,application/json,application/xml,text/xml,text/plain,application/yaml,text/yaml";

export function detectFormat(text: string, fileName = ""): FormatId | undefined {
  const name = fileName.toLowerCase();
  const head = text.replace(/^\uFEFF/, "").trimStart();
  const infra = sniffInfra(head);
  if (infra === "compose" || infra === "asyncapi" || infra === "kubernetes" || infra === "terraform") return infra;
  if (head.startsWith("{")) return infra ? undefined : "native";
  if (looksLikeDrawio(head)) return "drawio";
  if (looksLikeMermaid(head)) return "mermaid";
  if (/\.(drawio|xml)$/.test(name) && head.startsWith("<")) return "drawio";
  if (/\.(mmd|mermaid)$/.test(name)) return "mermaid";
  if (/\.json$/.test(name)) return "native";
  return undefined;
}

/** "My Pipeline.drawio" -> "My Pipeline". */
export function titleFromFileName(name: string): string {
  const base = name
    .replace(/^.*[\\/]/, "")
    .replace(/(\.diagram)?\.(json|drawio|xml|mmd|mermaid|svg)$/i, "")
    .replace(/\.drawio$/i, "");
  return base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "Imported diagram";
}

export type ImportOutcome =
  /** `report`: an infrastructure import's Import report, kept in memory (never in the file). */
  | {
      ok: true;
      format: FormatId;
      diagram: DiagramFile;
      warnings: string[];
      report?: ImportReport;
      /**
       * Terraform's **Draw everything**: the same import with every resource as a node, already read, as data
       * (names and connections, never the source text), for `importReplay`.
       */
      replay?: ImportGraph;
    }
  /** A draw.io file with several pages: the caller asks which one, then calls `pick`. */
  | { ok: "pages"; format: "drawio"; pages: { name: string; index: number }[]; pick: (index: number) => ImportOutcome }
  | { ok: false; error: string };

/** Converter output goes through the native validator too: one set of rules for everything stored. */
function validated(format: FormatId, diagram: DiagramFile, warnings: string[]): ImportOutcome {
  const r = validateDiagram(diagram);
  return r.ok
    ? { ok: true, format, diagram: r.diagram, warnings: [...warnings, ...r.warnings] }
    : { ok: false, error: r.error };
}

function drawioOutcome(
  { drawioPageToDiagram }: typeof import("./drawio/read"),
  doc: DrawioDocument,
  index: number,
  fallbackTitle: string,
): ImportOutcome {
  const page = doc.pages[index];
  const title =
    doc.pages.length > 1 && /^page-\d+$/i.test(page.name) ? `${fallbackTitle} (${page.name})` : fallbackTitle;
  const { diagram, warnings } = drawioPageToDiagram(page, title);
  if (!diagram.nodes.length) return { ok: false, error: `The page “${page.name}” has no shapes to import.` };
  return validated("drawio", diagram, warnings);
}

/** Parses text in any supported format. Never throws. */
export async function importText(text: string, fileName = ""): Promise<ImportOutcome> {
  if (!text.trim()) return { ok: false, error: "There's nothing to import: the text is empty." };
  if (text.length > LIMITS.maxTextChars) return { ok: false, error: tooLargeMessage(text.length) };
  const format = detectFormat(text, fileName);
  /** Recognised, but not imported (a Helm template, Terraform source): the infrastructure reader says what to do. */
  const later = format ? undefined : (sniffInfra(text) ?? (/\.tf$/i.test(fileName) ? "hcl" : undefined));
  const fallbackTitle = fileName ? titleFromFileName(fileName) : "Imported diagram";
  /** The loaded reader's own error type: its message is meant for the user. */
  let readerErrors: (new (message?: string) => Error)[] = [];
  try {
    if (format === "native") {
      const r = parseNative(text);
      return r.ok ? { ok: true, format, diagram: r.diagram, warnings: r.warnings } : { ok: false, error: r.error };
    }
    if (format === "drawio") {
      const reader = await drawioReader();
      readerErrors = [reader.DrawioError];
      const doc = await reader.readDrawio(text);
      if (doc.pages.length > 1) {
        return {
          ok: "pages",
          format,
          pages: doc.pages.map((p, index) => ({ name: p.name, index })),
          pick: (index) => drawioOutcome(reader, doc, index, fallbackTitle),
        };
      }
      return drawioOutcome(reader, doc, 0, fallbackTitle);
    }
    if (format === "mermaid") {
      const reader = await mermaidReader();
      readerErrors = [reader.MermaidError];
      const { diagram, warnings } = reader.parseMermaid(text, fallbackTitle);
      return validated(format, diagram, warnings);
    }
    if (format === "compose" || format === "asyncapi" || format === "kubernetes" || format === "terraform" || later) {
      const reader = await infraReader();
      readerErrors = [reader.ImportError];
      return reader.importInfra(text, fileName, later, format);
    }
  } catch (err) {
    if (readerErrors.some((type) => err instanceof type)) return { ok: false, error: (err as Error).message };
    return { ok: false, error: `Something went wrong reading it: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    ok: false,
    error:
      "That doesn't look like a diagram we can read. Supported: Live Diagrams files (.diagram.json), draw.io (.drawio / .xml), Mermaid flowcharts (.mmd), docker-compose files, Kubernetes manifests, AsyncAPI documents and Terraform plans (terraform show -json).",
  };
}

export interface ImportFile {
  name: string;
  text: string;
}

/**
 * Several files at once (Open… or a drop): grouped by format, and the largest group imports. A compose file
 * with its overrides is one diagram. One file is plain importText.
 */
export async function importFiles(files: readonly ImportFile[]): Promise<ImportOutcome> {
  if (files.length < 2) return importText(files[0]?.text ?? "", files[0]?.name);
  return (await infraReader()).importMany(files, detectFormat, importText);
}

/** Draws an import's replay (Terraform's Draw everything) as a new outcome. Never throws. */
export async function importReplay(graph: ImportGraph): Promise<ImportOutcome> {
  try {
    return (await infraReader()).replayOutcome(graph);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
