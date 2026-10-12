import { templatePath } from "virtual:interactive-viewer";
import type { DiagramFile } from "../model/types";
import { iconUrl } from "../stencils/registry";
import { loadOnce } from "../lib/lazyLoad";
import { downloadText } from "../interop/files";
import { toast } from "../interop/ui/toast";
import { exportHtml, FALLBACK_ICON, htmlFileName, templateStencilIcons, type ExportInput } from "./inject";

// File ▸ Export as ▸ Interactive HTML…: the viewer template (fetched from this site, once, when someone first
// exports), the icons the diagram uses (this site's own files), and the diagram, put together here and
// downloaded. Nothing is uploaded: the file is made in the page.

export type HtmlExportOptions = Omit<ExportInput, "diagram" | "iconSvgs" | "exportedOn">;

/** The template, relative to the page, so a build served from a sub-path finds its own. */
const loadTemplate = loadOnce(async () => {
  const res = await fetch(new URL(templatePath, document.baseURI));
  if (!res.ok)
    throw new Error(`The viewer couldn't be downloaded (${res.status}). Check your connection and try again.`);
  return res.text();
});

/** Starts the template download (the dialog opening), without waiting for it. */
export function preloadTemplate(): void {
  loadTemplate().catch(() => {});
}

/** The SVGs of the icons `diagram` shows (and the fallback box), from this site's icon files. */
async function iconSvgs(diagram: DiagramFile, stencilIcons: Record<string, string>): Promise<Record<string, string>> {
  const names = new Set([FALLBACK_ICON]);
  for (const n of diagram.nodes) if (stencilIcons[n.stencil]) names.add(stencilIcons[n.stencil]);
  const out: Record<string, string> = {};
  await Promise.all(
    [...names].map(async (name) => {
      const url = iconUrl(name);
      if (!url) return;
      const res = await fetch(url);
      if (res.ok) out[name] = await res.text();
    }),
  );
  return out;
}

/** The file's text. */
export async function buildInteractiveHtml(diagram: DiagramFile, options: HtmlExportOptions): Promise<string> {
  const template = await loadTemplate();
  const iconsBySvg = await iconSvgs(diagram, templateStencilIcons(template));
  return exportHtml(template, { ...options, diagram, iconSvgs: iconsBySvg });
}

/** Builds and downloads it; returns the file's name and size in bytes. */
export async function downloadInteractiveHtml(
  diagram: DiagramFile,
  options: HtmlExportOptions,
): Promise<{ name: string; bytes: number }> {
  const html = await buildInteractiveHtml(diagram, options);
  const name = htmlFileName(options.title ?? diagram.title);
  downloadText(html, name, "text/html");
  return { name, bytes: new Blob([html]).size };
}

/** The dialog's Download: the file, with progress and the outcome in a toast (never a thrown error). */
export async function exportInteractiveHtml(diagram: DiagramFile, options: HtmlExportOptions): Promise<void> {
  const busy = toast.busy("Making the HTML file…");
  try {
    const { name, bytes } = await downloadInteractiveHtml(diagram, options);
    toast.dismiss(busy);
    toast.success(`Exported “${name}” (${Math.max(1, Math.round(bytes / 1000))} kB). Anyone who has it can open it.`);
  } catch (err) {
    toast.dismiss(busy);
    toast.error(`Couldn't export the interactive HTML. ${err instanceof Error ? err.message : String(err)}`);
  }
}
