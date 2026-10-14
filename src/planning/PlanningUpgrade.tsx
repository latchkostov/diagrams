import { useRef, useState } from "react";
import type { EditorApi } from "../editor/types";
import { upgradePlanning, legacyExport } from "./migration";
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
  const d = preview ? editor.getDiagram() : undefined;
  const next = d && d.planning?.revision !== "p2" ? upgradePlanning(d) : undefined;
  const before = d && next ? analyzeCapacity(d, planningSimulation(d, explanationSimulation(d))) : undefined;
  const after = next ? analyzeCapacity(next, planningSimulation(next, explanationSimulation(next))) : undefined;
  const legacy = d?.planning ? legacyExport(d) : undefined;
  const capacity = (value: number) => (Number.isFinite(value) ? formatRate(value) : t("planning.unlimited"));
  return (
    <section className="insp-section" data-testid="planning-model">
      <h3 className="insp-section-title">{t("planning.model")}</h3>
      <p className="insp-note">
        {planning?.revision === "p2" ? t("broker.current") : planning ? t("planning.current") : t("planning.legacy")}
      </p>
      <button
        className="link-btn"
        data-testid="planning-preview"
        ref={previewButton}
        onClick={() => setPreview(!preview)}
        aria-expanded={preview}
      >
        {planning?.revision === "p2" ? t("planning.legacyPreview") : t("planning.preview")}
      </button>
      {d && next && before && after && (
        <div data-testid="planning-upgrade-preview">
          <p>{t("broker.upgradePreview")}</p>
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
              editor.applyDiagram(upgradePlanning(editor.getDiagram()));
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
            {d?.planning?.revision === "p2"
              ? t("broker.exportLoss")
              : t("planning.losses", { fields: formatList(legacy.losses) })}
          </p>
          {d?.planning?.revision === "p2" && <p>{formatList(legacy.losses)}</p>}
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
