import { workChoices } from "../lib/diagramPicker";
import { useSettings } from "../harness/settings";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";
import { edgeStyles, type EdgeStyle } from "../harness/edgeStyles";
import { Icon } from "./Icon";
import { LAB, type View } from "../lib/urlState";
import type { Interop } from "../interop/useInterop";
import { FileMenu, SaveStatus, SharedChip } from "../interop/ui/menus";
import { Menu } from "../interop/ui/Menu";
import { Glyph } from "../interop/ui/glyphs";
import { capacityOverlay } from "../live/capacityOverlay";
import { dependencyVisibility } from "../canvas/dependencyVisibility";
import { checksPanel } from "../canvas/checks/checksPanel";
import type { ExampleThemeInfo } from "../examples/themes";
import { BRAND_NAME, LANGUAGE_CHOICE } from "../lib/deployment";
import { getLocale, t } from "../i18n";
import { loadI18n, openLanguageDialog } from "../i18n/start";

export interface ExampleOption {
  slug: string;
  title: string;
  /** "yours": your diagrams (and a shared one); "examples": the built-in examples. */
  group: "yours" | "examples";
  localOnly?: boolean;
  /** An example's theme: the picker shows one group per theme ("Event streaming", "Data & AI"…). */
  theme?: ExampleThemeInfo;
}

interface Props {
  view: View;
  onView: (v: View) => void;
  exampleOptions: ExampleOption[];
  example?: string;
  onExample: (slug: string) => void;
  onBrowseExamples: () => void;
  copyNotice?: string;
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
  const localOptions = p.exampleOptions.filter((o) => o.localOnly);
  const choices = workChoices(p.exampleOptions, p.example);
  const canvas = p.view === "canvas";
  const lab = p.view === "lab";
  // The Lab is a dev harness: in dev builds and the e2e build (VITE_E2E=1) only; production has none (LAB).
  const showLab = LAB;

  return (
    <header className="topbar" data-testid="topbar">
      <div className="brand" data-testid="brand">
        <Logo />
        <span>{BRAND_NAME}</span>
      </div>

      <div className="segmented" role="tablist" aria-label={t("topbar.views")}>
        <button
          role="tab"
          aria-selected={canvas}
          className={canvas ? "is-on" : ""}
          onClick={() => p.onView("canvas")}
          data-testid="view-canvas"
        >
          <Icon name="canvas" size={14} /> {t("topbar.diagram")}
        </button>
        <button
          role="tab"
          aria-selected={p.view === "gallery"}
          className={p.view === "gallery" ? "is-on" : ""}
          onClick={() => p.onView("gallery")}
          data-testid="view-gallery"
        >
          <Icon name="grid" size={14} /> {t("topbar.stencils")}
        </button>
        {showLab && (
          <button
            role="tab"
            aria-selected={lab}
            className={lab ? "is-on" : ""}
            onClick={() => p.onView("lab")}
            data-testid="view-lab"
            // eslint-disable-next-line local/no-literal-ui-text -- the Lab is a development tool, in English
            title="Component lab: presets of the current code"
          >
            {/* eslint-disable-next-line local/no-literal-ui-text -- a development tool */}
            <LabGlyph /> Lab
          </button>
        )}
      </div>

      {canvas && (
        <Menu
          label={t("topbar.yourDiagrams")}
          testId="diagram-menu"
          width={300}
          entries={() => [
            { type: "section", label: t("topbar.yourDiagrams") },
            ...choices.items.map((o) => ({
              type: "item" as const,
              testId: `picker-option-${o.slug}`,
              title: o.title,
              checked: o.slug === p.example,
              onSelect: () => p.onExample(o.slug),
            })),
            ...(choices.overflow
              ? [
                  {
                    type: "item" as const,
                    testId: "picker-library",
                    title: t("topbar.yourDiagrams"),
                    onSelect: p.onLibrary,
                  },
                ]
              : []),
            { type: "item", testId: "picker-new", title: t("file.new"), onSelect: p.onNewDiagram },
            { type: "separator" },
            ...(localOptions.length
              ? [
                  {
                    type: "item" as const,
                    testId: "picker-local-examples",
                    title: t("topbar.examples"),
                    submenu: () => [
                      ...localOptions.slice(0, 10).map((o) => ({
                        type: "item" as const,
                        testId: `picker-local-${o.slug}`,
                        title: o.title,
                        checked: o.slug === p.example,
                        onSelect: () => p.onExample(o.slug),
                      })),
                      {
                        type: "item" as const,
                        testId: "picker-local-browse",
                        title: t("examples.browse"),
                        onSelect: p.onBrowseExamples,
                      },
                    ],
                  },
                ]
              : []),
            {
              type: "item",
              testId: "picker-browse-examples",
              title: t("examples.browse"),
              onSelect: p.onBrowseExamples,
            },
          ]}
          trigger={(props) => (
            <button
              className="btn diagram-picker"
              {...props}
              data-testid="example-picker"
              data-diagram-slug={p.example}
            >
              <span className="diagram-picker-title">
                {p.exampleOptions.find((o) => o.slug === p.example)?.title ?? t("file.new")}
              </span>
              {p.exampleOptions.some((o) => o.slug === p.example && o.group === "examples") && (
                <span className="example-badge" data-testid="example-badge">
                  {t("chrome.example")}
                </span>
              )}
              <Glyph name="chevron-down" size={12} />
            </button>
          )}
        />
      )}

      {canvas && p.copyNotice && (
        <div className="example-copy-notice" role="status" data-testid="example-copy-notice">
          {p.copyNotice}
        </div>
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
            title={t("topbar.presentTitle")}
          >
            <Icon name="present" size={14} /> <span className="label-optional">{t("topbar.present")}</span>
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => s.set("theme", s.theme === "dark" ? "light" : "dark")}
          aria-label={s.theme === "dark" ? t("topbar.toLight") : t("topbar.toDark")}
          title={s.theme === "dark" ? t("topbar.lightTheme") : t("topbar.darkTheme")}
          data-testid="theme-toggle"
        >
          <Icon name={s.theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
  );
}

const nodeNames: Record<NodeVariantId, () => string> = {
  card: () => t("view.node.card"),
  compact: () => t("view.node.compact"),
  iconOnly: () => t("view.node.iconOnly"),
};
const edgeNames: Record<EdgeStyle, () => string> = {
  smoothstep: () => t("view.edge.smoothstep"),
  bezier: () => t("view.edge.bezier"),
  straight: () => t("view.edge.straight"),
};

/** Look options (node renderer, edge style): one menu button instead of two selects in the bar. */
function ViewMenu({ edges, overlays }: { edges: boolean; overlays: boolean }) {
  const s = useSettings();
  return (
    <Menu
      label={t("view.menu")}
      testId="view-menu"
      width={240}
      // The language list comes with the lazy half of the i18n runtime: fetched as the menu opens.
      onOpen={LANGUAGE_CHOICE ? loadI18n : undefined}
      entries={() => [
        { type: "section", label: t("view.nodes") },
        ...Object.keys(nodeVariants).map((id) => ({
          type: "item" as const,
          testId: `view-node-${id}`,
          title: nodeNames[id as NodeVariantId](),
          checked: s.nodeVariant === id,
          onSelect: () => s.set("nodeVariant", id as NodeVariantId),
        })),
        ...(edges
          ? [
              { type: "section" as const, label: t("view.edges") },
              ...edgeStyles.map((e) => ({
                type: "item" as const,
                testId: `view-edge-${e.id}`,
                title: edgeNames[e.id](),
                checked: s.edgeStyle === e.id,
                onSelect: () => s.set("edgeStyle", e.id as EdgeStyle),
              })),
            ]
          : []),
        ...(overlays
          ? [
              { type: "section" as const, label: t("view.overlays") },
              {
                type: "item" as const,
                testId: "capacity-overlay-toggle",
                // eslint-disable-next-line local/no-literal-ui-text -- the live batch (docs/I18N.md): wording in flux
                title: "Show capacity",
                // eslint-disable-next-line local/no-literal-ui-text -- the live batch
                desc: "Colour services by how busy they are",
                shortcut: "C",
                checked: capacityOverlay.get(),
                onSelect: () => capacityOverlay.toggle(),
              },
              {
                type: "item" as const,
                testId: "dependencies-toggle",
                title: t("view.dependencies"),
                desc: t("view.dependenciesDesc"),
                checked: dependencyVisibility.get(),
                onSelect: () => dependencyVisibility.toggle(),
              },
              {
                type: "item" as const,
                testId: "view-checks",
                // eslint-disable-next-line local/no-literal-ui-text -- the checks batch (docs/I18N.md): wording in flux
                title: "Checks",
                // eslint-disable-next-line local/no-literal-ui-text -- the checks batch
                desc: "Likely design problems, with fixes",
                checked: checksPanel.isOpen(),
                disabled: !checksPanel.isAvailable(),
                onSelect: () => checksPanel.toggle(),
              },
            ]
          : []),
        // A copy built for one language (VITE_LOCALES) has no choice to offer.
        ...(LANGUAGE_CHOICE
          ? [
              { type: "separator" as const },
              {
                type: "item" as const,
                testId: "view-language",
                title: t("view.language"),
                // The English word too, so someone who can't read the language they landed in finds the way back.
                // eslint-disable-next-line local/no-literal-ui-text -- deliberately English
                desc: getLocale() === "en" ? undefined : "Language",
                onSelect: openLanguageDialog,
              },
            ]
          : []),
      ]}
      trigger={(props) => (
        <button
          className="btn"
          {...props}
          aria-label={t("view.menu")}
          title={t("view.buttonTitle")}
          data-testid="view-button"
        >
          <Glyph name="sliders" size={14} /> <span className="label-optional">{t("view.button")}</span>
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
