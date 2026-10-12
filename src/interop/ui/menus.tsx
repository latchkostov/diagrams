import { useEffect, useState } from "react";
import { formatCombo } from "../../editor/shortcuts";
import { formatAgo } from "../../lib/time";
import { PRIVATE_SHARE_MESSAGE } from "../../lib/localOnly";
import { newDiagramsPrivate } from "../../lib/privacyPrefs";
import type { Binding, Interop } from "../useInterop";
import { Menu, type MenuEntry } from "./Menu";
import { Glyph } from "./glyphs";

type Api = Omit<Interop, "layer">;

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
    const cloud = api.cloudProviders;
    const out: MenuEntry[] = [
      {
        type: "item",
        testId: "file-new",
        icon: <Glyph name="file" />,
        title: "New diagram",
        onSelect: onNewDiagram,
      },
      ...(onLibrary
        ? [
            {
              type: "item" as const,
              testId: "file-library",
              icon: <Glyph name="stack" />,
              title: "Your diagrams…",
              desc: libraryCount ? `${libraryCount} kept in this browser` : "Rename, duplicate or delete your diagrams",
              onSelect: onLibrary,
            },
          ]
        : []),
      {
        type: "item",
        testId: "file-open",
        icon: <Glyph name="folder" />,
        title: "Open…",
        desc: ".diagram.json, draw.io or Mermaid",
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
        title: "Open from",
        submenu: () => [
          {
            type: "item",
            testId: "open-from-device",
            icon: <Glyph name="device" />,
            title: "This device…",
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
    if (!canvas) return out;

    out.push(
      { type: "separator" },
      {
        type: "item",
        testId: "file-save",
        icon: <Glyph name="save" />,
        title: b ? "Save" : api.fsSupported ? "Save to this device…" : "Download file",
        desc: b
          ? `To ${b.providerId === "device" ? "" : `${b.label}: `}${b.name}`
          : api.fsSupported
            ? "Works in synced cloud folders"
            : undefined,
        shortcut: "Mod+S",
        onSelect: () => void api.save(),
      },
    );
    if (cloud.length) {
      // Every destination in one place: Save as on this device, or a new file in a provider.
      out.push({
        type: "item",
        testId: "file-save-to",
        submenuTestId: "file-save-to-menu",
        icon: <Glyph name="save" />,
        title: "Save to",
        submenu: () => [
          {
            type: "item",
            testId: "save-to-device",
            icon: <Glyph name="device" />,
            title: api.fsSupported ? "This device…" : "This device",
            desc: api.fsSupported ? undefined : "Downloads the file",
            shortcut: api.fsSupported ? "Mod+Shift+S" : undefined,
            onSelect: () => void api.saveTo("device"),
          },
          ...cloud.map((p): MenuEntry => ({
            type: "item",
            testId: `save-to-${p.id}`,
            icon: <Glyph name={p.icon} />,
            title: p.label,
            desc: api.privacy() ? "Off for private diagrams" : b?.providerId === p.id ? "Saves a new copy" : undefined,
            disabled: !!api.privacy(),
            onSelect: () => void api.saveTo(p.id),
          })),
        ],
      });
    } else if (api.fsSupported && b) {
      // Until the diagram is bound to a file, "Save to this device…" already asks where: Save as… joins it after.
      out.push({
        type: "item",
        testId: "export-save-as",
        icon: <Glyph name="save" />,
        title: "Save as…",
        shortcut: "Mod+Shift+S",
        onSelect: () => void api.saveAs(),
      });
    }
    // Sharing and privacy together: a private diagram's link rows stay in place, off, saying why.
    const privacy = api.privacy();
    out.push(
      { type: "separator" },
      {
        type: "item",
        testId: "file-privacy",
        submenuTestId: "file-privacy-menu",
        icon: <Glyph name="lock" />,
        title: "Privacy",
        desc: privacy ? "This diagram is private" : undefined,
        submenu: () => privacyMenu(api),
      },
      {
        type: "item",
        testId: "export-share-link",
        icon: <Glyph name="link" />,
        title: "Copy share link",
        desc: privacy ? PRIVATE_SHARE_MESSAGE : undefined,
        disabled: !!privacy,
        onSelect: () => void api.copyShareLink(),
      },
      {
        type: "item",
        testId: "export-share-link-password",
        icon: <Glyph name="lock" />,
        title: "Copy link with password…",
        disabled: !!privacy,
        onSelect: () => void api.copyPasswordLink(),
      },
      {
        type: "item",
        testId: "export-embed",
        icon: <Glyph name="code" />,
        title: "Embed code…",
        disabled: !!privacy,
        onSelect: api.openEmbed,
      },
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
        testId: "file-more-formats",
        submenuTestId: "file-more-formats-menu",
        icon: <Glyph name="download" />,
        title: "Export as",
        submenu: () => exportFormats(api),
      },
    );
    return out;
  };

  return (
    <Menu
      label="File"
      testId="file-menu"
      onOpen={api.preload}
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
  const text = savedAt ? `Saved to ${binding.inSentence} · ${formatAgo(savedAt)}` : `Opened from ${binding.inSentence}`;
  return (
    <span
      className="ix-save-status"
      title={`${binding.name}. ${formatCombo("Mod+S")} saves here again.`}
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
        title="Keep a copy in Your diagrams"
        data-testid="shared-keep"
      >
        Save a copy
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
      title: "Private diagram",
      desc:
        privacy === "local-only"
          ? "Always private: it comes from a local-only example"
          : "No share links, cloud saves or AI",
      checked: !!privacy,
      checkbox: true,
      disabled: privacy === "local-only",
      onSelect: () => void api.setPrivate(!privacy),
    },
    {
      type: "item",
      testId: "privacy-new-diagrams",
      title: "New diagrams are private",
      desc: "Diagrams you start or bring in from this device",
      checked: newDiagramsPrivate.get(),
      checkbox: true,
      onSelect: () => api.setNewDiagramsPrivate(!newDiagramsPrivate.get()),
    },
    { type: "note", text: "Export a file to share a private diagram." },
  ];
}

/** "Export as" formats. The canvas right-click "Export as" (useInterop.tsx) uses the same names and order. */
function exportFormats(api: Api): MenuEntry[] {
  return [
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
      testId: "export-mermaid-download",
      icon: <Glyph name="mermaid" />,
      title: "Mermaid file",
      hint: ".mmd",
      onSelect: () => void api.downloadMermaid(),
    },
    {
      type: "item",
      testId: "export-mermaid",
      icon: <Glyph name="mermaid" />,
      title: "Copy as Mermaid",
      onSelect: () => void api.copyMermaid(),
    },
  ];
}
