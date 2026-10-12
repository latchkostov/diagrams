import type { DiagramFile } from "../../model/types";
import { validateDiagram } from "../../interop/native";
import { PAYLOAD_VERSION, type ViewerOptions } from "../inject";

// The exported file's payload: the `#diagram` data block that src/export/inject.ts filled. Read once, and
// checked like every other way a diagram comes in (validateDiagram): the file may have been edited by hand.

export type ViewerPayload =
  | { ok: true; diagram: DiagramFile; icons: Record<string, string>; options: ViewerOptions }
  | { ok: false; error: string };

let cached: ViewerPayload | undefined;

function parse(): ViewerPayload {
  const text = document.getElementById("diagram")?.textContent?.trim();
  if (!text || text.startsWith("__"))
    return { ok: false, error: "This file has no diagram in it. Export it again from Live Diagrams." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file's diagram is damaged. Export it again from Live Diagrams." };
  }
  const p = raw as Partial<{ version: unknown; diagram: unknown; icons: unknown; options: Partial<ViewerOptions> }>;
  if (p?.version !== PAYLOAD_VERSION)
    return { ok: false, error: "This file comes from a newer version of Live Diagrams and can't be shown here." };
  const result = validateDiagram(p.diagram);
  if (!result.ok) return { ok: false, error: result.error };
  const icons: Record<string, string> = {};
  if (p.icons && typeof p.icons === "object")
    for (const [name, uri] of Object.entries(p.icons))
      // Only data: images: an icon must never make the page fetch anything.
      if (typeof uri === "string" && uri.startsWith("data:image/")) icons[name] = uri;
  const o = p.options ?? {};
  const sims = result.diagram.simulations ?? [];
  return {
    ok: true,
    diagram: result.diagram,
    icons,
    options: {
      theme: o.theme === "dark" ? "dark" : "light",
      banner: typeof o.banner === "string" && o.banner.trim() ? o.banner.trim().slice(0, 300) : undefined,
      startSimulation:
        typeof o.startSimulation === "string" && sims.some((s) => s.id === o.startSimulation)
          ? o.startSimulation
          : null,
      exportedOn: typeof o.exportedOn === "string" ? o.exportedOn.slice(0, 32) : "",
    },
  };
}

export function readPayload(): ViewerPayload {
  return (cached ??= parse());
}
