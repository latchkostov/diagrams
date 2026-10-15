import { useRef, useState } from "react";
import type { EditorApi } from "../editor/types";
import { upgradePlanning, upgradeAutoscaling, legacyExport } from "./migration";
import { analyzeCapacity } from "../sim/capacity";
import { planningSimulation } from "../sim/capacityPlanning";
import { explanationSimulation } from "./explanation";
import { withPrivacyField } from "../lib/diagramIO";
import { downloadText } from "../interop/files";
import { t, useLocale } from "../i18n";
import { formatList, formatRate } from "../i18n/format";
import type { DiagramFile } from "../model/types";

export function PlanningUpgrade({ editor, planning }: { editor: EditorApi; planning?: DiagramFile["planning"] }) {
  useLocale();
  const previewButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState(false);
  const [a1, setA1] = useState(false);
  const d = preview ? editor.getDiagram() : undefined;
  const next =
    d && a1
      ? upgradeAutoscaling(d)
      : d && d.planning?.revision !== "p3" && d.planning?.revision !== "p3-a1"
        ? upgradePlanning(d)
        : undefined;
  const before = d && next ? analyzeCapacity(d, planningSimulation(d, explanationSimulation(d))) : undefined;
  const after = next ? analyzeCapacity(next, planningSimulation(next, explanationSimulation(next))) : undefined;
  const legacy = d?.planning ? legacyExport(d) : undefined;
  const capacity = (value: number) => (Number.isFinite(value) ? formatRate(value) : t("admission.unknownShort"));
  return (
    <section className="insp-section" data-testid="planning-model">
      <h3 className="insp-section-title">{t("planning.model")}</h3>
      <p className="insp-note">
        {planning?.revision === "p3-a1"
          ? t("autoscaling.model")
          : planning?.revision === "p3"
            ? t("admission.model")
            : planning?.revision === "p2"
              ? t("broker.current")
              : planning
                ? t("planning.current")
                : t("planning.legacy")}
      </p>
      {planning?.revision !== "p3-a1" && (
        <button
          className="link-btn"
          data-testid="autoscaling-upgrade-preview"
          onClick={() => {
            setA1(true);
            setPreview(true);
          }}
        >
          {t("autoscaling.upgrade")}
        </button>
      )}
      <button
        className="link-btn"
        data-testid="planning-preview"
        ref={previewButton}
        onClick={() => {
          setA1(false);
          setPreview(!preview);
        }}
        aria-expanded={preview}
      >
        {planning?.revision === "p3" || planning?.revision === "p3-a1"
          ? t("planning.legacyPreview")
          : t("planning.preview")}
      </button>
      {d && next && before && after && (
        <div data-testid="planning-upgrade-preview">
          <p>{a1 ? t("autoscaling.upgradeHint") : t("admission.model")}</p>
          <ul>
            {d.nodes.map((n) => (
              <li key={n.id}>
                {t("planning.upgradeNode", {
                  name: n.label,
                  before: capacity(before.nodes[n.id].capacity),
                  after: capacity(after.nodes[n.id].capacity),
                })}
              </li>
            ))}
          </ul>
          <button
            className="btn btn-primary"
            data-testid="planning-upgrade"
            onClick={() => {
              editor.applyDiagram(a1 ? upgradeAutoscaling(editor.getDiagram()) : upgradePlanning(editor.getDiagram()));
              setPreview(false);
              previewButton.current?.focus();
            }}
          >
            {t("planning.upgrade")}
          </button>
        </div>
      )}
      {legacy && (
        <div data-testid="planning-legacy-preview">
          <p>
            {d?.planning?.revision === "p3"
              ? t("broker.exportLoss")
              : t("planning.losses", { fields: formatList(legacy.losses) })}
          </p>
          {d?.planning?.revision === "p3" && <p>{formatList(legacy.losses)}</p>}
          <button
            className={next ? "btn" : "btn btn-primary"}
            data-testid="planning-legacy-download"
            onClick={() =>
              downloadText(
                JSON.stringify(
                  legacyExport(withPrivacyField(editor.getDiagram(), editor.isPrivate?.() ?? false)).diagram,
                  null,
                  2,
                ),
                "legacy.diagram.json",
                "application/json",
              )
            }
          >
            {t("planning.downloadLegacy")}
          </button>
        </div>
      )}
    </section>
  );
}
