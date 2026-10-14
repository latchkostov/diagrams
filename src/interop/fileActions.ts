import type { Action, MenuItem, MenuNode } from "../editor/actions";
import type { InteropApi } from "./useInterop";
// A product name, identical in every language.
const DRAWIO = "draw.io";

import { t, msg } from "../i18n";

/**
 * The canvas right-click "Export" submenu. Saving and opening stay in the File menu (and Ctrl+S /
 * Ctrl+O); the right-click keeps only what acts on the picture in front of you. Item names match
 * the File menu exactly.
 */
export function fileActions(get: () => InteropApi): Action[] {
  const item = (id: string, label: string, run: () => unknown, hint?: string, keywords?: string): MenuItem => ({
    type: "item",
    id,
    label,
    hint,
    keywords,
    run: () => void run(),
  });
  return [
    {
      // Ctrl+K only: the File menu's Privacy ▸ and the badge beside the title are the visible controls.
      id: "file.private",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      paletteOnly: true,
      label: () => (get().privacy() ? t("fileDialog.makeNotPrivate") : t("fileDialog.makePrivate")),
      icon: "lock",
      enabled: () => get().privacy() !== "local-only",
      hint: () => (get().privacy() === "local-only" ? t("fileDialog.alwaysPrivate") : undefined),
      run: () => void get().setPrivate(!get().privacy()),
    },
    {
      // Ctrl+K only, while the open diagram has one: the import toast's Details is the visible way in.
      id: "file.import-report",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      paletteOnly: true,
      label: msg("importReport.importReport"),
      icon: "info",
      when: () => !!get().importReport,
      run: () => get().openImportReport(),
    },
    {
      // Replaces the editor's built-in JSON-only Export submenu.
      id: "canvas.export",
      modes: ["edit", "live"],
      section: "file",
      targets: ["canvas"],
      order: 20,
      label: msg("fileToast.export"),
      icon: "download",
      children: (): MenuNode[] => [
        item("export:png", t("file.exportPng"), () => get().exportPng({ scale: 2 }), "2×"),
        // Every way out, safest first, each saying who can open it: the File menu's Share… (and so Ctrl+K's).
        item(
          "export:share",
          t("file.share"),
          () => get().openShareChooser(),
          get().privacy() ? t("fileDialog.private") : undefined,
          "link password embed public send",
        ),
        { type: "separator" },
        item("export:json", t("export.file"), () => get().exportNative(), ".diagram.json"),
        item("export:image", t("export.image"), () => get().openImageOptions(), t("fileDialog.pngOrSvg")),
        item("export:html", t("export.html"), () => get().openHtmlExport(), ".html"),
        item("export:drawio", DRAWIO, () => get().exportDrawio(), ".drawio"),
        item("export:mermaid-download", t("export.mermaidFile"), () => get().downloadMermaid(), ".mmd"),
        item("export:mermaid", t("export.copyMermaid"), () => get().copyMermaid()),
      ],
    },
  ];
}
