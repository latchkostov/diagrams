import { useWorkbenchDock } from "../inspector/dockState";
import { usePhone } from "../../lib/usePhone";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { t, useLocale } from "../../i18n";
import type { View } from "../../lib/urlState";
import { AI_PANEL } from "../../lib/deployment";
import { checksPanel, useChecksPanel } from "../checks/checksPanel";
import { aiPanelTitle, openAiPanel } from "../../ai/ui/events";
import { railLabel, useUnseen } from "../../ai/ui/unseen";
import { paletteHost } from "../../palette/host";
import { tools, useToolHost, useToolSurface } from "./tools";
import "../../styles/canvas/tool-rail.css";

const noSubscribe = () => () => {};
const zero = () => 0;
export function ToolRail({ view, onView }: { view: View; onView: (view: View) => void }) {
  useLocale();
  const phone = usePhone();
  const host = useToolHost();
  const dock = useWorkbenchDock();
  const surface = useToolSurface();
  const checks = useChecksPanel();
  const warnings = useSyncExternalStore(
    host?.checks.subscribe ?? noSubscribe,
    host ? () => host.checks.get().warnings : zero,
  );
  const documentId = useSyncExternalStore(paletteHost.subscribe, () => paletteHost.get().canvas?.documentId);
  const fresh = useUnseen(documentId);
  const nav = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState(view === "canvas" ? "rail-select" : "view-canvas");
  const item = (
    id: string,
    label: string,
    icon: IconName,
    run: () => void,
    active = false,
    extra?: ReactNode,
    disabled = false,
    name = label,
  ) => (
    <button
      key={id}
      type="button"
      data-testid={id}
      className={active ? "is-on" : undefined}
      aria-label={name}
      title={id === "ai-rail-open" ? aiPanelTitle() : name}
      aria-pressed={active}
      tabIndex={focused === id ? 0 : -1}
      disabled={disabled}
      onFocus={() => setFocused(id)}
      onKeyDown={(e) => {
        const buttons = [...(nav.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const rtl = document.documentElement.dir === "rtl";
        const next = e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight");
        const previous = e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft");
        const at =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : next
                ? (index + 1) % buttons.length
                : previous
                  ? (index - 1 + buttons.length) % buttons.length
                  : -1;
        if (at >= 0) {
          e.preventDefault();
          buttons[at]?.focus();
        }
      }}
      onClick={run}
      {...(id === "rail-add" ? { draggable: true, onDragStart: () => tools.open("library") } : {})}
    >
      <Icon name={icon} size={20} />
      <span className="tool-rail-label">{label}</span>
      {extra}
    </button>
  );
  return (
    <nav className="tool-rail" aria-label={t("workbench.tools")} ref={nav} data-testid="tool-rail">
      {view !== "canvas" && item("view-canvas", t("topbar.diagram"), "canvas", () => onView("canvas"))}
      {item(
        "rail-select",
        t("workbench.select"),
        "pointer",
        () => {
          tools.open("closed");
          host?.select();
        },
        view === "canvas" && surface === "closed" && !checks.open,
        undefined,
        !host,
      )}
      {item(
        "rail-add",
        t("messageTypes.add"),
        "node-plus",
        () => tools.toggle("library"),
        surface === "library" || !!host?.pinned,
        undefined,
        !host,
      )}
      {item(
        "rail-annotate",
        t("menu.annotate"),
        "note",
        () => tools.toggle("annotate"),
        surface === "annotate",
        undefined,
        !host || host.live,
      )}
      {item(
        "checks-count",
        t("workbench.checks"),
        "checklist",
        () => checksPanel.toggle(),
        checks.open,
        <>
          <span className="sr-only" data-testid="checks-warning-text">
            {t("workbench.warnings", { count: warnings })}
          </span>
          {warnings > 0 && (
            <i className="tool-rail-badge" aria-hidden data-testid="checks-warning-badge">
              {warnings}
            </i>
          )}
        </>,
        !checks.available,
        t("workbench.checksName", { warnings: t("workbench.warnings", { count: warnings }) }),
      )}
      <details className="rail-overflow" open={phone ? undefined : true}>
        <summary data-testid="rail-more" aria-label={t("workbench.moreTools")}>
          ⋯
        </summary>
        <div className="rail-overflow-items">
          <div className="tool-rail-sep" />
          {item("view-gallery", t("topbar.stencils"), "grid", () => onView("gallery"), view === "gallery")}
          {item("view-tutorials", t("tutorials.section"), "learn", () => onView("tutorials"), view === "tutorials")}
          <div className="tool-rail-grow" />
          {item(
            "shortcuts-button",
            t("workbench.shortcuts"),
            "keyboard",
            () => host?.shortcuts(),
            false,
            undefined,
            !host,
          )}
          {AI_PANEL &&
            item(
              "ai-rail-open",
              t("ai.aI"),
              "ai",
              () => openAiPanel(),
              dock.value === "ai",
              fresh > 0 && (
                <i className="tool-rail-badge" aria-hidden data-testid="ai-rail-badge">
                  {fresh > 9 ? "9+" : fresh}
                </i>
              ),
              !host,
              railLabel(fresh),
            )}
        </div>
      </details>
    </nav>
  );
}
