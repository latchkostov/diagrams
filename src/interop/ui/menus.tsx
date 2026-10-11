import type { Interop } from "../useInterop";
import { Menu, type MenuEntry } from "./Menu";
import { Glyph } from "./glyphs";

type Api = Omit<Interop, "layer">;

/**
 * The top bar's single File menu. Common actions first (Save, Open, Export PNG, Copy share link),
 * then "More formats" and "Import from" submenus. Google Drive rows exist only when configured.
 * On views without a canvas (gallery, Lab) only the opening actions show.
 */
export function FileMenu({ api, canvas }: { api: Api; canvas: boolean }) {
  const entries = (): MenuEntry[] => {
    const b = api.binding;
    const drive = api.driveEnabled;
    const out: MenuEntry[] = [];
    if (canvas) {
      out.push({
        type: "item",
        testId: "file-save",
        icon: <Glyph name="save" />,
        title: b ? "Save" : api.fsSupported ? "Save to device…" : "Download file",
        desc: b
          ? `To ${b.kind === "drive" ? "Google Drive: " : ""}${b.name}`
          : api.fsSupported
            ? "Works in synced cloud folders"
            : undefined,
        shortcut: "Mod+S",
        onSelect: () => void api.save(),
      });
    }
    out.push({
      type: "item",
      testId: "file-open",
      icon: <Glyph name="folder" />,
      title: "Open…",
      desc: ".diagram.json, .drawio, .mmd",
      shortcut: "Mod+O",
      onSelect: () => void api.openFile(),
    });
    if (drive) {
      out.push({
        type: "item",
        testId: "file-open-drive",
        icon: <Glyph name="drive" />,
        title: "Open from Google Drive…",
        onSelect: () => void api.openFromDrive(),
      });
      if (canvas) {
        out.push({
          type: "item",
          testId: "file-save-drive",
          icon: <Glyph name="drive" />,
          title: b?.kind === "drive" ? "Save a copy to Google Drive" : "Save to Google Drive",
          onSelect: () => void api.saveToDrive(b?.kind === "drive"),
        });
      }
    }
    if (canvas) {
      out.push(
        { type: "separator" },
        {
          type: "item",
          testId: "export-png",
          icon: <Glyph name="image" />,
          title: "Export PNG",
          hint: "2×",
          onSelect: () => void api.exportPng({ scale: 2 }),
        },
        {
          type: "item",
          testId: "export-share-link",
          icon: <Glyph name="link" />,
          title: "Copy share link",
          onSelect: () => void api.copyShareLink(),
        },
        { type: "separator" },
        {
          type: "item",
          testId: "file-more-formats",
          submenuTestId: "file-more-formats-menu",
          icon: <Glyph name="download" />,
          title: "More formats",
          submenu: () => [
            {
              type: "item",
              testId: "export-json",
              icon: <Glyph name="json" />,
              title: "Diagram file",
              hint: ".diagram.json",
              onSelect: () => void api.exportNative(),
            },
            {
              type: "item",
              testId: "export-image",
              icon: <Glyph name="image" />,
              title: "Image…",
              desc: "PNG or SVG, size and background",
              onSelect: api.openImageOptions,
            },
            {
              type: "item",
              testId: "export-drawio",
              icon: <Glyph name="drawio" />,
              title: "draw.io",
              hint: ".drawio",
              onSelect: () => void api.exportDrawio(),
            },
            {
              type: "item",
              testId: "export-mermaid",
              icon: <Glyph name="mermaid" />,
              title: "Copy as Mermaid",
              onSelect: () => void api.copyMermaid(),
            },
            {
              type: "item",
              testId: "export-mermaid-download",
              icon: <Glyph name="mermaid" />,
              title: "Mermaid file",
              hint: ".mmd",
              onSelect: () => void api.downloadMermaid(),
            },
            { type: "separator" },
            {
              type: "item",
              testId: "export-embed",
              icon: <Glyph name="code" />,
              title: "Embed code…",
              onSelect: api.openEmbed,
            },
            ...(api.fsSupported
              ? [
                  {
                    type: "item" as const,
                    testId: "export-save-as",
                    icon: <Glyph name="save" />,
                    title: "Save as…",
                    shortcut: "Mod+Shift+S",
                    onSelect: () => void api.saveAs(),
                  },
                ]
              : []),
          ],
        },
      );
    }
    out.push({
      type: "item",
      testId: "file-import-from",
      submenuTestId: "file-import-menu",
      icon: <Glyph name="upload" />,
      title: "Import from",
      submenu: () => [
        {
          type: "item",
          testId: "import-paste",
          icon: <Glyph name="clipboard" />,
          title: "Paste text…",
          desc: "JSON, draw.io XML or Mermaid",
          onSelect: api.openPaste,
        },
        {
          type: "item",
          testId: "import-share-link",
          icon: <Glyph name="link" />,
          title: "Share link…",
          onSelect: api.openShareLink,
        },
        { type: "note", text: "Or drop a file anywhere on the page." },
      ],
    });
    return out;
  };

  return (
    <Menu
      label="File"
      testId="file-menu"
      onOpen={api.preloadDrive}
      entries={entries}
      width={320}
      trigger={(props) => (
        <button
          className="btn"
          {...props}
          aria-label="File"
          data-testid="file-button"
          title="Save, open, export and share"
        >
          <Glyph name="file" size={14} /> <span className="label-optional">File</span>
          <span className="ix-caret">
            <Glyph name="chevron-down" size={12} />
          </span>
        </button>
      )}
    />
  );
}

/** Top-bar chip while a shared diagram is open: it's kept apart from the user's own until saved. */
export function SharedChip({ onKeep, replaces }: { onKeep: () => void; replaces?: string }) {
  return (
    <div
      className="ix-shared"
      role="status"
      data-testid="shared-banner"
      title="Opened from a share link. Your edits stay in this browser."
    >
      <Glyph name="link" size={13} />
      <span>Shared</span>
      <button
        className="ix-shared-keep"
        onClick={onKeep}
        title={
          replaces ? `Keep it as your imported diagram (replaces “${replaces}”)` : "Keep it as your imported diagram"
        }
        data-testid="shared-keep"
      >
        Save a copy
      </button>
    </div>
  );
}
