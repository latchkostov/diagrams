import { t } from "../i18n";
import { formatBytes } from "../i18n/format";
import { templatePath } from "virtual:interactive-viewer";
import type { DiagramFile } from "../model/types";
import { iconUrl } from "../stencils/registry";
import { loadOnce } from "../lib/lazyLoad";
import { downloadText } from "../interop/files";
import { validateDiagram } from "../interop/native";
import { toast } from "../interop/ui/toast";
import {
  buildPayload,
  exportHtml,
  FALLBACK_ICON,
  htmlFileName,
  injectLocked,
  templateStencilIcons,
  type ExportInput,
} from "./inject";
import { lockedFileName, lockPayload } from "./lock";

// File ▸ Export as ▸ Interactive HTML…: the viewer template (fetched from this site, once, when someone first
// exports), the icons the diagram uses (this site's own files), and the diagram, put together here and
// downloaded. Nothing is uploaded: the file is made in the page. With a password, the payload is encrypted here too
// (./lock.ts), and the file is titled LOCKED_TITLE and named for it with a random suffix: nothing of the diagram is
// readable without the password.

export type HtmlExportOptions = Omit<ExportInput, "diagram" | "iconSvgs" | "exportedOn"> & {
  /** Require a password: the file holds the payload encrypted with it (./lock.ts). Never stored or sent. */
  password?: string;
};

/** The template, relative to the page, so a build served from a sub-path finds its own. */
const loadTemplate = loadOnce(async () => {
  const res = await fetch(new URL(templatePath, document.baseURI));
  if (!res.ok) throw new Error(t("htmlExport.theViewerCouldntBeDownloadedValue0Check", { value0: res.status }));
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
  // The same contract the viewer checks when it opens the file: never write one it would refuse.
  const checked = validateDiagram(diagram);
  if (!checked.ok) throw new Error(checked.error);
  const { password, ...rest } = options;
  const template = await loadTemplate();
  const input: ExportInput = { ...rest, diagram, iconSvgs: await iconSvgs(diagram, templateStencilIcons(template)) };
  if (password === undefined) return exportHtml(template, input);
  return injectLocked(template, await lockPayload(buildPayload(template, input), password));
}

/** Builds and downloads it; returns the file's name and size in bytes. */
export async function downloadInteractiveHtml(
  diagram: DiagramFile,
  options: HtmlExportOptions,
): Promise<{ name: string; bytes: number }> {
  const html = await buildInteractiveHtml(diagram, options);
  // A protected file's name says nothing of the diagram either, and a random suffix keeps two apart.
  const name = options.password !== undefined ? lockedFileName() : htmlFileName(options.title ?? diagram.title);
  downloadText(html, name, "text/html");
  return { name, bytes: new Blob([html]).size };
}

/** The dialog's Download: the file, with progress and the outcome in a toast (never a thrown error). */
export async function exportInteractiveHtml(diagram: DiagramFile, options: HtmlExportOptions): Promise<void> {
  const locked = options.password !== undefined;
  const busy = toast.busy(locked ? t("htmlExport.encryptingTheHTMLFile") : t("htmlExport.makingTheHTMLFile"));
  try {
    const { name, bytes } = await downloadInteractiveHtml(diagram, options);
    toast.dismiss(busy);
    toast.success(t("htmlExport.exported", { name, size: formatBytes(bytes), locked: locked ? "yes" : "no" }));
  } catch (err) {
    toast.dismiss(busy);
    toast.error(
      t("htmlExport.couldntExportTheInteractiveHTMLValue0", {
        value0: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
