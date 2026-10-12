import { useSettings } from "../harness/settings";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";
import { edgeStyles, type EdgeStyle } from "../harness/edgeStyles";
import { Icon } from "./Icon";
import type { View } from "../lib/urlState";
import type { Interop } from "../interop/useInterop";
import { FileMenu, SaveStatus, SharedChip } from "../interop/ui/menus";
import { Menu } from "../interop/ui/Menu";
import { Glyph } from "../interop/ui/glyphs";
import { capacityOverlay } from "../live/capacityOverlay";
import { dependencyVisibility } from "../canvas/dependencyVisibility";
import { groupByTheme, type ExampleThemeInfo } from "../examples/themes";

export interface ExampleOption {
  slug: string;
  title: string;
  /** "yours": your diagrams (and a shared one); "examples": the built-in examples. */
  group: "yours" | "examples";
  /** An example's theme: the picker shows one group per theme ("Event streaming", "Data & AI"…). */
  theme?: ExampleThemeInfo;
}

/** The picker's groups: Your diagrams, then examples by theme (unthemed ones under "Examples"). */
function pickerGroups(options: ExampleOption[]) {
  return [
    { id: "yours", label: "Your diagrams", options: options.filter((o) => o.group === "yours") },
    ...groupByTheme(
      options.filter((o) => o.group === "examples"),
      (o) => o.theme?.id,
    ).map((s) => ({ id: s.theme?.id ?? "examples", label: s.theme?.label ?? "Examples", options: s.items })),
  ];
}

interface Props {
  view: View;
  onView: (v: View) => void;
  exampleOptions: ExampleOption[];
  example?: string;
  onExample: (slug: string) => void;
  /** Import / export / storage controller (src/interop). */
  interop: Omit<Interop, "layer">;
  /** Set while a diagram from a share link is open: offers to keep it. */
  shared?: { onKeep: () => void };
  onPresent: () => void;
  onNewDiagram: () => void;
  /** Opens "Your diagrams". */
  onLibrary: () => void;
  libraryCount: number;
}

export function TopBar(p: Props) {
  const s = useSettings();
  const canvas = p.view === "canvas";
  const lab = p.view === "lab";
  // The Lab is a dev harness: linked from the top bar in dev builds only. Production keeps it
  // reachable by URL (?view=lab) and shows the tab only while you're on it. The e2e build (VITE_E2E=1)
  // keeps the dev behaviour so the suite can run against a production bundle.
  const showLab = import.meta.env.DEV || import.meta.env.VITE_E2E === "1" || lab;

  return (
    <header className="topbar" data-testid="topbar">
      <div className="brand" data-testid="brand">
        <Logo />
        <span>Live Diagrams</span>
      </div>

      <div className="segmented" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={canvas}
          className={canvas ? "is-on" : ""}
          onClick={() => p.onView("canvas")}
          data-testid="view-canvas"
        >
          <Icon name="canvas" size={14} /> Diagram
        </button>
        <button
          role="tab"
          aria-selected={p.view === "gallery"}
          className={p.view === "gallery" ? "is-on" : ""}
          onClick={() => p.onView("gallery")}
          data-testid="view-gallery"
        >
          <Icon name="grid" size={14} /> Stencils
        </button>
        {showLab && (
          <button
            role="tab"
            aria-selected={lab}
            className={lab ? "is-on" : ""}
            onClick={() => p.onView("lab")}
            data-testid="view-lab"
            title="Component lab: presets of the current code"
          >
            <LabGlyph /> Lab
          </button>
        )}
      </div>

      {canvas && (
        <label className="select">
          <span className="sr-only">Diagram</span>
          <select
            value={p.example}
            onChange={(e) => p.onExample(e.target.value)}
            name="example"
            data-testid="example-picker"
          >
            {pickerGroups(p.exampleOptions).map((g) => (
              <optgroup key={g.id} label={g.label} data-testid={`picker-group-${g.id}`}>
                {g.options.map((o) => (
                  <option key={o.slug} value={o.slug} data-testid={`picker-option-${o.slug}`}>
                    {o.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      {canvas && p.shared && <SharedChip {...p.shared} />}
      {canvas && !p.shared && <SaveStatus binding={p.interop.binding} />}

      <div className="topbar-spacer" />

      <div className="topbar-group" data-testid="topbar-actions">
        <ViewMenu edges={canvas || lab} overlays={canvas} />
        <FileMenu
          api={p.interop}
          canvas={canvas}
          onNewDiagram={p.onNewDiagram}
          onLibrary={p.onLibrary}
          libraryCount={p.libraryCount}
        />
        {canvas && (
          <button
            className="btn btn-primary"
            onClick={p.onPresent}
            data-testid="present-toggle"
            title="Present: full screen for meetings (Esc to leave)"
          >
            <Icon name="present" size={14} /> <span className="label-optional">Present</span>
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => s.set("theme", s.theme === "dark" ? "light" : "dark")}
          aria-label={s.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={s.theme === "dark" ? "Light theme" : "Dark theme"}
          data-testid="theme-toggle"
        >
          <Icon name={s.theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

/** Look options (node renderer, edge style): one menu button instead of two selects in the bar. */
function ViewMenu({ edges, overlays }: { edges: boolean; overlays: boolean }) {
  const s = useSettings();
  return (
    <Menu
      label="View options"
      testId="view-menu"
      width={240}
      entries={() => [
        { type: "section", label: "Nodes" },
        ...Object.entries(nodeVariants).map(([id, v]) => ({
          type: "item" as const,
          testId: `view-node-${id}`,
          title: v.label,
          checked: s.nodeVariant === id,
          onSelect: () => s.set("nodeVariant", id as NodeVariantId),
        })),
        ...(edges
          ? [
              { type: "section" as const, label: "Edges" },
              ...edgeStyles.map((e) => ({
                type: "item" as const,
                testId: `view-edge-${e.id}`,
                title: e.label,
                checked: s.edgeStyle === e.id,
                onSelect: () => s.set("edgeStyle", e.id as EdgeStyle),
              })),
            ]
          : []),
        ...(overlays
          ? [
              { type: "section" as const, label: "Overlays" },
              {
                type: "item" as const,
                testId: "capacity-overlay-toggle",
                title: "Show capacity",
                desc: "Colour services by how busy they are",
                shortcut: "C",
                checked: capacityOverlay.get(),
                onSelect: () => capacityOverlay.toggle(),
              },
              {
                type: "item" as const,
                testId: "dependencies-toggle",
                title: "Show dependencies",
                desc: "Config, secret, identity and other dotted edges",
                checked: dependencyVisibility.get(),
                onSelect: () => dependencyVisibility.toggle(),
              },
            ]
          : []),
      ]}
      trigger={(props) => (
        <button
          className="btn"
          {...props}
          aria-label="View options"
          title="Node and edge style, and overlays"
          data-testid="view-button"
        >
          <Glyph name="sliders" size={14} /> <span className="label-optional">View</span>
          <span className="ix-caret">
            <Glyph name="chevron-down" size={12} />
          </span>
        </button>
      )}
    />
  );
}

function LabGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 2h4M6.75 2v4.25L3 12.75A1 1 0 0 0 3.9 14.25h8.2a1 1 0 0 0 .9-1.5L9.25 6.25V2M4.75 10h6.5" />
    </svg>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="logo">
      <rect x="1.5" y="3" width="8" height="6" rx="2" className="logo-a" />
      <rect x="14.5" y="15" width="8" height="6" rx="2" className="logo-b" />
      <path d="M9.5 6h3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 0 2.5 2.5" fill="none" className="logo-wire" />
      <circle cx="12.5" cy="6" r="1.4" className="logo-dot" />
    </svg>
  );
}
