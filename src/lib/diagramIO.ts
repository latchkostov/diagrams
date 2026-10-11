import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";
import { examples } from "../examples";

export const IMPORTED_SLUG = "imported";
const AUTOSAVE_PREFIX = "diagrams.autosave.v1:";
const IMPORTED_KEY = "diagrams.imported.v1";

export type ParseResult = { ok: true; diagram: DiagramFile } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates an imported file just enough to render it safely. */
export function parseDiagram(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON. Choose a .json file exported from Diagrams." };
  }
  if (!isObj(data)) return { ok: false, error: "That file doesn't contain a diagram object." };
  if (data.format !== DIAGRAM_FORMAT) {
    const found = typeof data.format === "string" ? `"${data.format}"` : "missing";
    return {
      ok: false,
      error: `Expected format "${DIAGRAM_FORMAT}", but it was ${found}. Export a diagram from this app to get a compatible file.`,
    };
  }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return { ok: false, error: "The diagram needs both a nodes and an edges list." };
  }
  for (const n of data.nodes) {
    if (!isObj(n) || typeof n.id !== "string" || typeof n.stencil !== "string" || typeof n.x !== "number" || typeof n.y !== "number") {
      return { ok: false, error: "Every node needs an id, a stencil, and numeric x and y." };
    }
  }
  const ids = new Set((data.nodes as { id: string }[]).map((n) => n.id));
  for (const e of data.edges) {
    if (!isObj(e) || typeof e.id !== "string" || typeof e.from !== "string" || typeof e.to !== "string") {
      return { ok: false, error: "Every edge needs an id, a from and a to." };
    }
    if (!ids.has(e.from) || !ids.has(e.to)) {
      return { ok: false, error: `Edge "${e.id}" points at a node that isn't in the file.` };
    }
  }
  const diagram = data as unknown as DiagramFile;
  if (typeof diagram.title !== "string") diagram.title = "Untitled diagram";
  return { ok: true, diagram };
}

export function downloadDiagram(diagram: DiagramFile, slug: string) {
  const blob = new Blob([JSON.stringify(diagram, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug || "diagram"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function read<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function getImported(): DiagramFile | undefined {
  return read<DiagramFile>(IMPORTED_KEY);
}

export function setImported(d: DiagramFile) {
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(d));
  localStorage.removeItem(AUTOSAVE_PREFIX + IMPORTED_SLUG);
}

/** The pristine diagram for a slug (example or the imported file). */
export function getOriginal(slug: string): DiagramFile | undefined {
  if (slug === IMPORTED_SLUG) return getImported();
  return examples.find((e) => e.slug === slug)?.diagram;
}

export function getAutosave(slug: string): DiagramFile | undefined {
  const d = read<DiagramFile>(AUTOSAVE_PREFIX + slug);
  return d && d.format === DIAGRAM_FORMAT && Array.isArray(d.nodes) ? d : undefined;
}

export function writeAutosave(slug: string, d: DiagramFile | null) {
  if (d) localStorage.setItem(AUTOSAVE_PREFIX + slug, JSON.stringify(d));
  else localStorage.removeItem(AUTOSAVE_PREFIX + slug);
}

export const emptyDiagram = (): DiagramFile => ({
  format: DIAGRAM_FORMAT,
  title: "Untitled diagram",
  nodes: [],
  edges: [],
});
