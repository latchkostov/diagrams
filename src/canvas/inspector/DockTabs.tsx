import { useRef } from "react";
import { t, useLocale } from "../../i18n";
import { AI_PANEL } from "../../lib/deployment";
import { workbenchDock, type DockTab } from "./dockState";
export function DockTabs({
  active,
  warnings,
  fresh,
  id,
  onSelect,
  checksAvailable,
  onEscape,
}: {
  active: DockTab;
  warnings: number;
  fresh: number;
  id: string;
  onSelect(tab: DockTab): void;
  checksAvailable: boolean;
  onEscape(): void;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const tabs: { tab: DockTab; label: string; count?: number }[] = [
    { tab: "properties", label: t("menu.properties") },
    { tab: "checks", label: t("workbench.checks"), count: warnings },
    ...(AI_PANEL ? [{ tab: "ai" as const, label: t("ai.aI"), count: fresh }] : []),
  ];
  return (
    <div
      ref={root}
      className="dock-tabs"
      role="tablist"
      tabIndex={-1}
      aria-label={t("workbench.tools")}
      onKeyDown={(e) => {
        if (e.key === "Escape" && active === "checks") {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
          const next = workbenchDock.get().value;
          root.current?.querySelector<HTMLButtonElement>('[data-testid="dock-tab-' + next + '"]')?.focus();
          return;
        }
        const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const rtl = document.documentElement.dir === "rtl";
        const next = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
        const previous = e.key === (rtl ? "ArrowRight" : "ArrowLeft");
        const index =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : next
                ? (at + 1) % buttons.length
                : previous
                  ? (at - 1 + buttons.length) % buttons.length
                  : -1;
        if (index >= 0) {
          e.preventDefault();
          buttons[index]?.click();
          buttons[index]?.focus();
        }
      }}
    >
      {tabs.map(({ tab, label, count }) => (
        <button
          key={tab}
          id={id + "-" + tab}
          data-testid={"dock-tab-" + tab}
          role="tab"
          aria-selected={active === tab}
          aria-controls={id + "-panel"}
          tabIndex={active === tab ? 0 : -1}
          disabled={tab === "checks" && !checksAvailable}
          onClick={() => onSelect(tab)}
        >
          {label}
          {!!count && <span className="dock-tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}
