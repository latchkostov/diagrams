import type { DiagramFile } from "../model/types";
import { getStencil } from "../stencils/registry";
import { iconUrl } from "../stencils/iconUrls";
import { nativeShape } from "./drawio/mapping";
import { textToBase64 } from "./codec";

/**
 * Fetches (as base64) the icons a draw.io export will inline: stencils draw.io has no built-in
 * shape for. Returns a lookup for `diagramToDrawio({ iconSvg })`.
 */
export async function inlineIcons(d: DiagramFile): Promise<(stencilId: string) => string | undefined> {
  const needed = [...new Set(d.nodes.map((n) => n.stencil))].filter((id) => !nativeShape(id));
  const out = new Map<string, string>();
  await Promise.all(
    needed.map(async (id) => {
      const url = iconUrl(getStencil(id).icon);
      if (!url) return;
      try {
        const res = await fetch(url);
        if (res.ok) out.set(id, textToBase64(await res.text()));
      } catch {
        /* fall back to a tinted box for this stencil */
      }
    }),
  );
  return (id) => out.get(id);
}
