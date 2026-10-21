import { validated } from "../importOutcome";
import type { ImportOutcome } from "../formats";
import { drawioPageToDiagram, type DrawioDocument } from "./read";
export { readDrawio, DrawioError } from "./read";

export function drawioOutcome(doc: DrawioDocument, index: number, fallbackTitle: string): ImportOutcome {
  const page = doc.pages[index];
  const title =
    doc.pages.length > 1 && /^page-\d+$/i.test(page.name) ? `${fallbackTitle} (${page.name})` : fallbackTitle;
  const { diagram, warnings } = drawioPageToDiagram(page, title);
  if (!diagram.nodes.length) return { ok: false, error: `The page “${page.name}” has no shapes to import.` };
  return validated("drawio", diagram, warnings);
}
