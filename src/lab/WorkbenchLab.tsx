import { useState } from "react";
import { DockTabs } from "../canvas/inspector/DockTabs";
import type { DockTab } from "../canvas/inspector/dockState";
import { FindingMarker } from "../canvas/checks/ChecksMarkers";
import { RunChart } from "../live/RunChart";
import { RunHistory } from "../live/runHistory";
import { formatCount, formatRate } from "../live/format";
import { t } from "../i18n";
import "../styles/canvas/inspector.css";
import "../styles/live.css";

export function WorkbenchTabsLab() {
  const [active, setActive] = useState<DockTab>("properties");
  const label =
    active === "properties" ? t("menu.properties") : active === "checks" ? t("workbench.checks") : t("ai.aI");
  return (
    <div style={{ width: 372 }}>
      <DockTabs
        id="lab-workbench"
        active={active}
        warnings={4}
        fresh={2}
        checksAvailable
        onSelect={setActive}
        onEscape={() => {
          setActive("properties");
          return "properties" as const;
        }}
      />
      <div
        id="lab-workbench-panel"
        role="tabpanel"
        aria-labelledby={"lab-workbench-" + active}
        data-testid="lab-dock-panel"
        style={{ padding: 24 }}
      >
        {label}
      </div>
    </div>
  );
}
export function WorkbenchChartLab() {
  const [history] = useState(() => {
    const h = new RunHistory();
    h.sample({ time: 0, inSystem: 0, nodes: {} }, 1);
    h.probe("service");
    for (let t = 200; t <= 18000; t += 200)
      h.sample(
        {
          time: t,
          inSystem: t / 15,
          nodes: {
            service: { throughput: t < 8000 ? 120 : 120 + (t - 8000) / 80, backlog: t < 6000 ? 0 : (t - 6000) / 8 },
          },
        },
        1,
      );
    return h;
  });
  return (
    <div style={{ width: 372, padding: 16, background: "var(--panel)" }}>
      <RunChart
        history={history}
        node="service"
        name={t("inspector.node")}
        time={18000}
        total={60000}
        markers={[
          { atMs: 8000, kind: "status", label: t("hover.fault") },
          { atMs: 10000, kind: "note", label: t("workbench.thisRun") },
        ]}
        vitals={[
          { key: "rate", label: t("hover.throughput"), value: formatRate(245) },
          { key: "queue", label: t("hover.queue"), value: formatCount(1500) },
        ]}
      />
    </div>
  );
}
export function WorkbenchTagsLab() {
  const [selected, setSelected] = useState(true);
  const title = t("workbench.checks");
  return (
    <div className="check-markers" style={{ position: "relative", width: 320, height: 120 }}>
      <FindingMarker
        mark={{
          id: "lab-service",
          x: 160,
          y: 60,
          severity: "warning",
          title,
          hot: false,
          count: 3,
          selected: selected ? { id: "lab-finding", number: 1, title } : undefined,
        }}
        onSelect={() => setSelected(true)}
        onFilter={() => setSelected((value) => !value)}
      />
    </div>
  );
}

export function WorkbenchScrimLab() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="lab-scrim-toggle" onClick={() => setOpen(!open)}>
        {open ? t("common.close") : t("workbench.readNote")}
      </button>
      <div
        data-testid="lab-scrim-card"
        style={{ position: "relative", width: 200, height: 120, background: "#808080" }}
      >
        {open && <div className="lv-note-scrim" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />}
      </div>
    </div>
  );
}
