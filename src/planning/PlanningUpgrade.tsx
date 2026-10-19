import { useLayoutEffect, useRef, useState } from "react";
import type { EditorApi } from "../editor/types";
import { upgradePlanning, upgradeAutoscaling, upgradeWaits, legacyExport } from "./migration";
import { analyzeCapacity } from "../sim/capacity";
import { planningSimulation } from "../sim/capacityPlanning";
import { explanationSimulation } from "./explanation";
import { withPrivacyField } from "../lib/diagramIO";
import { downloadText } from "../interop/files";
import { t, useLocale } from "../i18n";
import { formatList, formatRate } from "../i18n/format";
import type { DiagramFile } from "../model/types";

export function PlanningUpgrade({
  editor,
  planning,
  initialPreview = false,
  takePreviewFocus,
}: {
  editor: EditorApi;
  planning?: DiagramFile["planning"];
  initialPreview?: boolean;
  takePreviewFocus?: () => boolean;
}) {
  useLocale();
  const previewButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<"a1" | "waits" | "legacy" | null>(initialPreview ? "a1" : null);
  const upgradeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (initialPreview && (takePreviewFocus?.() ?? true)) upgradeButton.current?.focus();
  }, [initialPreview, takePreviewFocus]);
  const a1 = preview === "a1";
  const waits = preview === "waits";
  const d = preview ? editor.getDiagram() : undefined;
  const next =
    d && waits
      ? upgradeWaits(d)
      : d && a1
        ? upgradeAutoscaling(d)
        : d && d.planning?.revision !== "p3" && d.planning?.revision !== "p3-a1" && d.planning?.revision !== "p3-w1"
          ? upgradePlanning(d)
          : undefined;
  const before = d && next ? analyzeCapacity(d, planningSimulation(d, explanationSimulation(d))) : undefined;
  const after = next ? analyzeCapacity(next, planningSimulation(next, explanationSimulation(next))) : undefined;
  const legacy = preview === "legacy" && d?.planning ? legacyExport(d) : undefined;
  const capacity = (value: number) => (Number.isFinite(value) ? formatRate(value) : t("admission.unknownShort"));
  const upgradeContent = d && next && before && after && (
    <div data-testid="planning-upgrade-preview">
      <p>{waits ? t("threads.upgradeHint") : a1 ? t("autoscaling.upgradeHint") : t("admission.model")}</p>
      <ul>
        {(waits ? d.nodes.filter((n) => after.nodes[n.id].waits) : d.nodes).map((n) => (
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
          editor.applyDiagram(
            waits
              ? upgradeWaits(editor.getDiagram())
              : a1
                ? upgradeAutoscaling(editor.getDiagram())
                : upgradePlanning(editor.getDiagram()),
          );
          setPreview(null);
          previewButton.current?.focus();
        }}
      >
        {t("planning.upgrade")}
      </button>
    </div>
  );
  return (
    <section className="insp-section" data-testid="planning-model">
      <h3 className="insp-section-title">{t("planning.model")}</h3>
      <p className="insp-note">
        {planning?.revision === "p3-w1"
          ? t("threads.model")
          : planning?.revision === "p3-a1"
            ? t("autoscaling.model")
            : planning?.revision === "p3"
              ? t("admission.model")
              : planning?.revision === "p2"
                ? t("broker.current")
                : planning
                  ? t("planning.current")
                  : t("planning.legacy")}
      </p>
      {planning?.revision !== "p3-w1" && (
        <button
          className="link-btn"
          data-testid="waits-upgrade-preview"
          aria-expanded={waits}
          aria-controls="planning-waits-content"
          onClick={() => setPreview(waits ? null : "waits")}
        >
          {t("threads.upgrade")}
        </button>
      )}
      <div id="planning-waits-content" hidden={!waits}>
        {waits && upgradeContent}
      </div>
      {planning?.revision !== "p3-a1" && planning?.revision !== "p3-w1" && (
        <button
          className="link-btn"
          data-testid="autoscaling-upgrade-preview"
          ref={upgradeButton}
          aria-expanded={a1}
          aria-controls="planning-a1-content"
          onClick={() => {
            setPreview(preview === "a1" ? null : "a1");
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
          setPreview(preview === "legacy" ? null : "legacy");
        }}
        aria-expanded={preview === "legacy"}
        aria-controls="planning-legacy-content"
      >
        {planning?.revision === "p3" || planning?.revision === "p3-a1" || planning?.revision === "p3-w1"
          ? t("planning.legacyPreview")
          : t("planning.preview")}
      </button>
      <div id="planning-a1-content" hidden={!a1}>
        {a1 && upgradeContent}
      </div>
      <div id="planning-legacy-content" hidden={preview !== "legacy"}>
        {preview === "legacy" && upgradeContent}
        {legacy && (
          <div data-testid="planning-legacy-preview">
            {d?.planning?.revision === "p3-w1" && <p>{t("threads.exportLoss")}</p>}
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
      </div>
    </section>
  );
}
