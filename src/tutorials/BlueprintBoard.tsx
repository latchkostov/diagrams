import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../i18n";
import { iconUrl } from "../stencils/iconUrls";
import { getStencil } from "../stencils/registry";
import { buildBlueprint, blueprintLayout, type Blueprint } from "./blueprint";
import { createTutorialStart } from "./start";
import { lessonNumber } from "./handoff";
import type { Tutorial } from "./types";

function Drawing({ blueprint }: { blueprint: Blueprint }) {
  const marker = useId();
  const layout = blueprintLayout(blueprint);
  return (
    <svg
      className="handoff-drawing"
      data-testid="tutorial-handoff-drawing"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden
    >
      <defs>
        <marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path d="m0 0 7 3.5L0 7" fill="currentColor" />
        </marker>
      </defs>
      {blueprint.edges.map((edge) => {
        const a = layout.positions.get(edge.from),
          b = layout.positions.get(edge.to);
        if (!a || !b) return null;
        const x1 = a.x + 140,
          y1 = a.y + 22,
          x2 = b.x - 3,
          y2 = b.y + 22;
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <path
              className="handoff-wire"
              d={`M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`}
              markerEnd={`url(#${marker})`}
            />
            {edge.label && (
              <text className="handoff-edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 14} textAnchor="middle">
                {edge.label}
              </text>
            )}
            {edge.marks.map((n, i) => (
              <g
                className="handoff-svg-mark"
                key={n}
                transform={`translate(${(x1 + x2) / 2} ${(y1 + y2) / 2 - 16 - i * 20})`}
              >
                <circle r="9" />
                <text dy=".35em">{n}</text>
              </g>
            ))}
          </g>
        );
      })}
      {blueprint.nodes.map((node) => {
        const p = layout.positions.get(node.subject)!;
        return (
          <g key={node.subject} transform={`translate(${p.x} ${p.y})`}>
            <rect className="handoff-node" width="140" height="44" rx="6" />
            <rect className="handoff-tile" x="5" y="6" width="30" height="32" rx="4" />
            <image href={iconUrl(getStencil(node.stencil).icon)} x="10" y="12" width="20" height="20" />
            <text
              className="handoff-node-label"
              x="41"
              y="26"
              textLength={node.label.length > 15 ? 93 : undefined}
              lengthAdjust="spacingAndGlyphs"
            >
              {node.label}
            </text>
            {node.marks.map((n, i) => (
              <g
                className="handoff-svg-mark"
                key={n}
                transform={`translate(${130 - (node.marks.length - 1 - i) * 20} -2)`}
              >
                <circle r="9" />
                <text dy=".35em">{n}</text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function valueText(value: unknown): string {
  if (value === undefined) return t("tutorials.handoff.notSet");
  if (typeof value === "boolean") return value ? t("tutorials.handoff.on") : t("tutorials.handoff.off");
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Reuses the cancellable lesson loader; previews never mount a second editor or start a lesson. */
export function BlueprintBoard({ lesson, catalog }: { lesson: Tutorial; catalog: readonly Tutorial[] }) {
  useLocale();
  const [loader] = useState(() => createTutorialStart(lesson));
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  useEffect(() => loader.connect(), [loader]);
  const blueprint =
    state.diagram && buildBlueprint(lesson, typeof lesson.start === "function" ? lesson.start() : state.diagram);
  return (
    <div
      className={`handoff-board${blueprint?.kind === "settings" ? " is-settings" : ""}`}
      data-testid="tutorial-handoff-board"
    >
      <div className="handoff-board-content" data-testid="tutorial-handoff-board-content">
        {blueprint ? (
          blueprint.kind === "settings" ? (
            <dl className="handoff-settings" data-testid="tutorial-handoff-settings">
              {blueprint.changes.map((change, i) => (
                <div key={i}>
                  <dt>
                    <span className="handoff-mark" aria-hidden>
                      {change.step}
                    </span>
                    {change.setting}
                    {change.detail && <span>{change.detail}</span>}
                  </dt>
                  <dd>
                    <span>{valueText(change.before)}</span>
                    <span aria-label={t("tutorials.handoff.becomes")}>→</span>
                    <strong>{valueText(change.after)}</strong>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <Drawing blueprint={blueprint} />
          )
        ) : state.value === "failed" ? (
          <button className="btn" data-testid="tutorial-handoff-preview-retry" onClick={loader.retry}>
            {t("common.retry")}
          </button>
        ) : (
          <span>{t("common.loading")}</span>
        )}
      </div>
      <div className="handoff-titleblock">
        <span className="handoff-lesson-number">{lessonNumber(lesson, catalog)}</span>
        <div>
          <small>{t("tutorials.handoff.nextLesson")}</small>
          <h3>{lesson.title()}</h3>
        </div>
        <div>
          <small>{t("tutorials.handoff.time")}</small>
          <span>{t("tutorials.handoff.minutes", { count: lesson.minutes })}</span>
        </div>
      </div>
    </div>
  );
}
