import { useWorkbenchDock } from "../inspector/dockState";
import { usePhone } from "../../lib/usePhone";
import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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
  const live = host?.live;
  const dock = useWorkbenchDock();
  const surface = useToolSurface();
  const checks = useChecksPanel();
  const warnings = useSyncExternalStore(
    host?.checks.subscribe ?? noSubscribe,
    host ? () => host.checks.get().warnings : zero,
  );
  const warningText = t("workbench.warnings", { count: warnings });
  const documentId = useSyncExternalStore(paletteHost.subscribe, () => paletteHost.get().canvas?.documentId);
  const fresh = useUnseen(documentId);
  const nav = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  const returning = useRef(false);
  const reconcile = () => {
    const controls = [...(nav.current?.querySelectorAll<HTMLElement>("button, summary") ?? [])];
    const enabled = controls.filter((el) => !el.hasAttribute("disabled") && el.getClientRects().length > 0);
    const previous = focused.current;
    const stop = enabled.includes(previous!)
      ? previous
      : (enabled.find((el) => el.dataset.testid === "rail-select") ?? enabled[0]);
    for (const el of controls) el.tabIndex = el === stop ? 0 : -1;
    if (returning.current && host && view === "canvas" && stop?.dataset.testid === "rail-select") {
      returning.current = false;
      stop.focus();
    } else if (
      stop &&
      !(returning.current && !host) &&
      previous &&
      previous !== stop &&
      (document.activeElement === previous || (document.activeElement === document.body && !previous.isConnected))
    )
      stop.focus();
  };
  useLayoutEffect(reconcile);
  const item = (
    id: string,
    label: string,
    name: string,
    icon: IconName,
    run: () => void,
    active = false,
    extra?: ReactNode,
    disabled?: boolean,
    title = name,
  ) => (
    <button
      key={id}
      type="button"
      data-testid={id}
      className={active ? "is-on" : undefined}
      aria-label={name.startsWith(label) ? name : `${label}, ${name}`}
      title={title}
      aria-pressed={active}
      tabIndex={-1}
      disabled={disabled}
      onClick={run}
      draggable={id === "rail-add" && !disabled}
      onDragStart={id === "rail-add" ? () => tools.open("library") : undefined}
    >
      <Icon name={icon} size={20} />
      <span className="tool-rail-label" data-testid="rail-label">
        {label}
      </span>
      {extra}
    </button>
  );
  return (
    <div
      role="toolbar"
      className="tool-rail"
      aria-label={t("workbench.tools")}
      ref={nav}
      data-testid="tool-rail"
      onFocus={(e) => {
        focused.current = e.target as HTMLElement;
        reconcile();
      }}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.testid === "view-canvas")
          returning.current = true;
      }}
      onKeyDown={(e) => {
        const buttons = [
          ...(nav.current?.querySelectorAll<HTMLElement>("button:not(:disabled), summary") ?? []),
        ].filter((el) => el.getClientRects().length > 0);
        const index = buttons.indexOf(document.activeElement as HTMLElement);
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
    >
      {view !== "canvas" &&
        item("view-canvas", t("rail.diagram"), t("topbar.diagram"), "canvas", () => onView("canvas"))}
      {item(
        "rail-select",
        t("rail.select"),
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
        t("rail.add"),
        t("rail.add"),
        "node-plus",
        () => tools.toggle("library"),
        surface === "library" || !!host?.pinned,
        undefined,
        !host || live,
        live ? t("workbench.addInLive") : undefined,
      )}
      {item(
        "rail-annotate",
        t("rail.annotate"),
        t("menu.annotate"),
        "note",
        () => tools.toggle("annotate"),
        surface === "annotate",
        undefined,
        !host || live,
        live ? t("workbench.annotateInLive") : undefined,
      )}
      {item(
        "checks-count",
        t("rail.checks"),
        t("workbench.checksName", { warnings: warningText }),
        "checklist",
        () => checksPanel.toggle(),
        checks.open,
        <>
          <span className="sr-only" data-testid="checks-warning-text">
            {warningText}
          </span>
          {warnings > 0 && (
            <i className="tool-rail-badge" aria-hidden data-testid="checks-warning-badge">
              {warnings}
            </i>
          )}
        </>,
        !checks.available,
      )}
      <details className="rail-overflow" open={phone ? undefined : true} onToggle={reconcile}>
        <summary data-testid="rail-more" aria-label={t("workbench.moreTools")} tabIndex={-1}>
          ⋯
        </summary>
        <div className="rail-overflow-items">
          <div className="tool-rail-sep" />
          {item(
            "view-gallery",
            t("rail.stencils"),
            t("topbar.stencils"),
            "grid",
            () => onView("gallery"),
            view === "gallery",
          )}
          {item(
            "view-tutorials",
            t("rail.tutorials"),
            t("tutorials.section"),
            "learn",
            () => onView("tutorials"),
            view === "tutorials",
          )}
          <div className="tool-rail-grow" />
          {item(
            "shortcuts-button",
            t("rail.shortcuts"),
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
              t("rail.ai"),
              railLabel(fresh),
              "ai",
              () => openAiPanel(),
              dock.value === "ai",
              fresh > 0 && (
                <i className="tool-rail-badge" aria-hidden data-testid="ai-rail-badge">
                  {fresh > 9 ? "9+" : fresh}
                </i>
              ),
              !host,
              aiPanelTitle(),
            )}
        </div>
      </details>
    </div>
  );
}
