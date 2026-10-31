import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogInteraction } from "../components/useDialogInteraction";
import { t } from "../i18n";
import { tracks } from "./catalog";
import { withoutProgress, type ResetScope, type StoredTutorials } from "./progress";
import { chapterSeals } from "./seals";
import type { TrackId, Tutorial } from "./types";

export function ResetProgressDialog({
  initialScope,
  current,
  progress,
  onClose,
  onConfirm,
  restoreFocus,
}: {
  initialScope: ResetScope;
  current: Tutorial;
  progress: StoredTutorials;
  onClose: () => void;
  onConfirm: (scope: ResetScope) => void;
  restoreFocus: (opener: HTMLElement | null) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useDialogInteraction(panel, backdrop, onClose, restoreFocus);
  const [kind, setKind] = useState<"all" | "track" | "lesson">(
    "track" in initialScope ? "track" : "lesson" in initialScope ? "lesson" : "all",
  );
  const [track, setTrack] = useState<TrackId>("track" in initialScope ? initialScope.track : current.track);
  const scope: ResetScope = kind === "all" ? { all: true } : kind === "track" ? { track } : { lesson: current.id };
  const after = withoutProgress(progress, scope);
  const removed = Object.entries(progress.progress ?? {})
    .filter(([id]) => !after.progress?.[id])
    .map(([, p]) => p);
  const done = removed.filter((p) => p.completed).length;
  const going = removed.filter((p) => !p.completed).length;
  const seals = Object.keys(progress.marks ?? {}).filter((id) => after.marks?.[id] === undefined).length;
  const numeral = chapterSeals.find((seal) => seal.track === track)!.numeral;
  const confirm =
    kind === "all"
      ? t("tutorials.syllabus.resetAllButton")
      : kind === "track"
        ? t("tutorials.syllabus.resetChapterButton", { number: numeral })
        : t("tutorials.syllabus.resetLessonButton");
  return createPortal(
    <div ref={backdrop} className="ix-backdrop" data-editor-overlay>
      <div
        ref={panel}
        className="ix-dialog tutorials-reset-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tutorials-reset-title"
        aria-describedby="tutorials-reset-description tutorials-reset-counts"
        tabIndex={-1}
        data-testid="tutorials-reset-dialog"
      >
        <header className="ix-dialog-head">
          <div className="ix-dialog-titles">
            <h2 id="tutorials-reset-title">{t("tutorials.syllabus.resetTitle")}</h2>
            <p id="tutorials-reset-description">{t("tutorials.syllabus.resetIntro")}</p>
          </div>
        </header>
        <div className="ix-dialog-body">
          <div className="tutorials-reset-options" role="radiogroup" aria-label={t("tutorials.syllabus.resetScope")}>
            {(["all", "track", "lesson"] as const).map((option) => (
              <div key={option} className={`tutorials-reset-option${kind === option ? " is-selected" : ""}`}>
                <label>
                  <input
                    type="radio"
                    name="tutorial-reset-scope"
                    checked={kind === option}
                    onChange={() => setKind(option)}
                    data-testid={`tutorials-reset-scope-${option}`}
                  />
                  <b>
                    {option === "all"
                      ? t("tutorials.syllabus.everything")
                      : option === "track"
                        ? t("tutorials.syllabus.oneChapter")
                        : t("tutorials.syllabus.currentLesson", { title: current.title() })}
                  </b>
                </label>
                {option === "track" && (
                  <select
                    aria-label={t("tutorials.syllabus.oneChapter")}
                    value={track}
                    onChange={(e) => {
                      setTrack(e.target.value as TrackId);
                      setKind("track");
                    }}
                    data-testid="tutorials-reset-chapter-select"
                  >
                    {tracks.map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {chapterSeals[index].numeral} {item.label()}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          <p id="tutorials-reset-counts" data-testid="tutorials-reset-counts" aria-live="polite">
            {t("tutorials.syllabus.resetCounts", { done, going, seals })}
          </p>
          <p className="tutorials-reset-note">{t("tutorials.syllabus.resetUndoHint")}</p>
        </div>
        <footer className="ix-dialog-foot">
          <button className="btn btn-ghost" data-autofocus data-testid="tutorials-reset-cancel" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-danger" data-testid="tutorials-reset-confirm" onClick={() => onConfirm(scope)}>
            {confirm}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
