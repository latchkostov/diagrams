import { useEffect, useState } from "react";
import { formatCombo } from "../../editor/shortcuts";
import { formatAgo } from "../../i18n/relativeTime";
import { LINK_OPEN, SHARE_LINKS } from "../../lib/deployment";
import { newDiagramsPrivate } from "../../lib/privacyPrefs";
import type { Binding, Interop } from "../useInterop";
import { Menu, type MenuEntry } from "./Menu";
import { Glyph } from "./glyphs";
import { t } from "../../i18n";

type Api = Omit<Interop, "layer"> & { tutorial?: true };

/**
 * The top bar's single File menu, grouped by intent: start or bring in a diagram, save it, share
 * it, export it. Formats live one level down ("Export as"). Cloud storage (Google Drive, OneDrive,
 * Dropbox) adds one "Open from ▸" and one "Save to ▸" submenu, and only when at least one provider is
 * configured; otherwise the menu is exactly the device-only one. On views without a canvas (stencils,
 * Lab) only the starting actions show.
 */
export function FileMenu({
  api,
  canvas,
  onNewDiagram,
  onLibrary,
  libraryCount = 0,
}: {
  api: Api;
  canvas: boolean;
  onNewDiagram: () => void;
  /** Opens "Your diagrams" (the local library). */
  onLibrary?: () => void;
  libraryCount?: number;
}) {
  const entries = (): MenuEntry[] => {
    const b = api.binding;
    const tutorial = api.tutorial;
    const cloud = api.cloudProviders;
    const out: MenuEntry[] = [
      {
        type: "item",
        testId: "file-new",
        icon: <Glyph name="file" />,
        title: t("file.new"),
        onSelect: onNewDiagram,
      },
      ...(onLibrary
        ? [
            {
              type: "item" as const,
              testId: "file-library",
              icon: <Glyph name="stack" />,
              title: t("file.library"),
              desc: libraryCount ? t("file.libraryCount", { count: libraryCount }) : t("file.libraryEmpty"),
              onSelect: onLibrary,
            },
          ]
        : []),
      {
        type: "item",
        testId: "file-open",
        icon: <Glyph name="folder" />,
        title: t("file.open"),
        desc: t("file.openDesc"),
        shortcut: "Mod+O",
        onSelect: () => void api.openFile(),
      },
    ];
    if (cloud.length) {
      out.push({
        type: "item",
        testId: "file-open-from",
        submenuTestId: "file-open-from-menu",
        icon: <Glyph name="cloud" />,
        title: t("file.openFrom"),
        submenu: () => [
          {
            type: "item",
            testId: "open-from-device",
            icon: <Glyph name="device" />,
            title: t("storage.thisDeviceMore"),
            shortcut: "Mod+O",
            onSelect: () => void api.openFrom("device"),
          },
          ...cloud.map((p): MenuEntry => ({
            type: "item",
            testId: `open-from-${p.id}`,
            icon: <Glyph name={p.icon} />,
            title: `${p.label}…`,
            onSelect: () => void api.openFrom(p.id),
          })),
        ],
      });
    }
    out.push({
      type: "item",
      testId: "file-import-from",
      submenuTestId: "file-import-menu",
      icon: <Glyph name="upload" />,
      title: t("file.importFrom"),
      submenu: () => [
        {
          type: "item",
          testId: "import-paste",
          icon: <Glyph name="clipboard" />,
          title: t("file.pasteText"),
          desc: t("file.pasteTextDesc"),
          onSelect: api.openPaste,
        },
        // A copy deployed without opening links (src/lib/deployment.ts) has no row for it.
        ...(LINK_OPEN
          ? [
              {
                type: "item" as const,
                testId: "import-share-link",
                icon: <Glyph name="link" />,
                title: t("file.shareLink"),
                onSelect: api.openShareLink,
              },
            ]
          : []),
        { type: "note", text: t("file.dropNote") },
      ],
    });
    if (!canvas) return out;

    out.push(
      { type: "separator" },
      {
        type: "item",
        testId: tutorial ? "export-save-as" : "file-save",
        icon: <Glyph name="save" />,
        title: tutorial
          ? t("file.saveAs")
          : b
            ? t("file.save")
            : api.fsSupported
              ? t("file.saveToDevice")
              : t("file.download"),
        desc: tutorial
          ? undefined
          : b
            ? b.providerId === "device"
              ? t("file.saveDestination", { name: b.name })
              : t("file.saveDestinationIn", { provider: b.label, name: b.name })
            : api.fsSupported
              ? t("file.saveDescSynced")
              : undefined,
        shortcut: tutorial ? "Mod+Shift+S" : "Mod+S",
        onSelect: () => void (tutorial ? api.saveAs() : api.save()),
      },
    );
    if (!tutorial && cloud.length) {
      // Every destination in one place: Save as on this device, or a new file in a provider.
      out.push({
        type: "item",
        testId: "file-save-to",
        submenuTestId: "file-save-to-menu",
        icon: <Glyph name="save" />,
        title: t("file.saveTo"),
        submenu: () => [
          {
            type: "item",
            testId: "save-to-device",
            icon: <Glyph name="device" />,
            title: api.fsSupported ? t("storage.thisDeviceMore") : t("storage.thisDevice"),
            desc: api.fsSupported ? undefined : t("file.downloadsFile"),
            shortcut: api.fsSupported ? "Mod+Shift+S" : undefined,
            onSelect: () => void api.saveTo("device"),
          },
          ...cloud.map((p): MenuEntry => ({
            type: "item",
            testId: `save-to-${p.id}`,
            icon: <Glyph name={p.icon} />,
            title: p.label,
            desc: api.privacy() ? t("file.offForPrivate") : b?.providerId === p.id ? t("file.savesNewCopy") : undefined,
            disabled: !!api.privacy(),
            onSelect: () => void api.saveTo(p.id),
          })),
        ],
      });
    } else if (!tutorial && api.fsSupported && b) {
      // Until the diagram is bound to a file, "Save to this device…" already asks where: Save as… joins it after.
      out.push({
        type: "item",
        testId: "export-save-as",
        icon: <Glyph name="save" />,
        title: t("file.saveAs"),
        shortcut: "Mod+Shift+S",
        onSelect: () => void api.saveAs(),
      });
    }
    // Sharing and privacy together. Share… lists every way out, safest first, each saying who can open it; a private
    // diagram (and a copy deployed without share links, src/lib/deployment.ts) gets only the ones it allows.
    const privacy = api.privacy();
    out.push(
      { type: "separator" },
      {
        type: "item",
        testId: "file-share",
        icon: <Glyph name="share" />,
        title: t("file.share"),
        desc: privacy || !SHARE_LINKS ? t("file.shareDescLimited") : t("file.shareDesc"),
        onSelect: api.openShareChooser,
      },
      {
        type: "item",
        testId: "file-privacy",
        submenuTestId: "file-privacy-menu",
        icon: <Glyph name="lock" />,
        title: t("file.privacy"),
        desc: privacy ? t("file.privacyDesc") : undefined,
        submenu: () => privacyMenu(api),
      },
      { type: "separator" },
      {
        type: "item",
        testId: "export-png",
        icon: <Glyph name="image" />,
        title: t("file.exportPng"),
        hint: "2×",
        onSelect: () => void api.exportPng({ scale: 2 }),
      },
      {
        type: "item",
        testId: "file-more-formats",
        submenuTestId: "file-more-formats-menu",
        icon: <Glyph name="download" />,
        title: t("file.exportAs"),
        submenu: () => exportFormats(api),
      },
    );
    return out;
  };

  return (
    <Menu
      label={t("file.menu")}
      testId="file-menu"
      onOpen={api.preload}
      entries={entries}
      width={320}
      trigger={(props) => (
        <button
          className="btn"
          {...props}
          aria-label={t("file.menu")}
          data-testid="file-button"
          title={t("file.buttonTitle")}
        >
          <Glyph name="file" size={14} /> <span className="label-optional">{t("file.menu")}</span>
          <span className="ix-caret">
            <Glyph name="chevron-down" size={12} />
          </span>
        </button>
      )}
    />
  );
}

/**
 * Quiet text beside the diagram picker: where Save writes this diagram and when it last did
 * ("Saved to OneDrive · 2 min ago"). Not a control; hidden on narrow screens. Nothing shows until
 * the diagram has a destination (opened from or saved to a file).
 */
export function SaveStatus({ binding }: { binding?: Binding }) {
  const savedAt = binding?.savedAt;
  // Re-render now and then so "2 min ago" stays true.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [savedAt]);
  if (!binding) return null;
  const where = binding.providerId === "device" ? t("storage.thisDeviceInSentence") : binding.inSentence;
  const text = savedAt ? t("status.savedTo", { where, ago: formatAgo(savedAt) }) : t("status.openedFrom", { where });
  return (
    <span
      className="ix-save-status"
      title={t("status.title", { name: binding.name, keys: formatCombo("Mod+S") })}
      data-testid="save-status"
      data-provider={binding.providerId}
    >
      {text}
    </span>
  );
}

/** Top-bar chip while a shared diagram is open: it's kept apart from the user's own until saved. */
export function SharedChip({ onKeep }: { onKeep: () => void }) {
  return (
    <div className="ix-shared" role="status" data-testid="shared-banner" title={t("shared.title")}>
      <Glyph name="link" size={13} />
      <span>{t("shared.chip")}</span>
      <button className="ix-shared-keep" onClick={onKeep} title={t("shared.keepTitle")} data-testid="shared-keep">
        {t("shared.keep")}
      </button>
    </div>
  );
}

/** File ▸ Privacy: this diagram's Private switch, and the setting for new ones. */
function privacyMenu(api: Api): MenuEntry[] {
  const privacy = api.privacy();
  return [
    {
      type: "item",
      testId: "privacy-diagram",
      title: t("privacy.diagram"),
      desc: privacy === "local-only" ? t("privacy.diagramAlways") : t("privacy.diagramDesc"),
      checked: !!privacy,
      checkbox: true,
      disabled: privacy === "local-only",
      onSelect: () => void api.setPrivate(!privacy),
    },
    {
      type: "item",
      testId: "privacy-new-diagrams",
      title: t("privacy.newDiagrams"),
      desc: t("privacy.newDiagramsDesc"),
      checked: newDiagramsPrivate.get(),
      checkbox: true,
      onSelect: () => api.setNewDiagramsPrivate(!newDiagramsPrivate.get()),
    },
    { type: "note", text: t("privacy.note") },
    { type: "separator" },
    {
      type: "item",
      testId: "privacy-clear-device",
      title: t("privacy.clear"),
      onSelect: () => api.openClearDevice(),
    },
  ];
}

/** "Export as" formats. The canvas right-click "Export as" (useInterop.tsx) uses the same names and order. */
function exportFormats(api: Api): MenuEntry[] {
  return [
    {
      type: "item",
      testId: "export-json",
      icon: <Glyph name="json" />,
      title: t("export.file"),
      hint: ".diagram.json",
      onSelect: () => void api.exportNative(),
    },
    {
      type: "item",
      testId: "export-image",
      icon: <Glyph name="image" />,
      title: t("export.image"),
      desc: t("export.imageDesc"),
      onSelect: api.openImageOptions,
    },
    {
      type: "item",
      testId: "export-html",
      icon: <Glyph name="play" />,
      title: t("export.html"),
      hint: ".html",
      onSelect: api.openHtmlExport,
    },
    {
      type: "item",
      testId: "export-drawio",
      icon: <Glyph name="drawio" />,
      // eslint-disable-next-line local/no-literal-ui-text -- a product name
      title: "draw.io",
      hint: ".drawio",
      onSelect: () => void api.exportDrawio(),
    },
    {
      type: "item",
      testId: "export-mermaid-download",
      icon: <Glyph name="mermaid" />,
      title: t("export.mermaidFile"),
      hint: ".mmd",
      onSelect: () => void api.downloadMermaid(),
    },
    {
      type: "item",
      testId: "export-mermaid",
      icon: <Glyph name="mermaid" />,
      title: t("export.copyMermaid"),
      onSelect: () => void api.copyMermaid(),
    },
  ];
}
