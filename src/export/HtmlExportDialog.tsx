import { useEffect, useState } from "react";
import type { DiagramFile } from "../model/types";
import { Dialog } from "../interop/ui/Dialog";
import { Disclosure } from "../interop/ui/dialogs";
import { Glyph } from "../interop/ui/glyphs";
import { exportInteractiveHtml, preloadTemplate } from "./exportHtml";
import "./htmlExport.css";

/** The one line every Interactive HTML export shows (docs/UX-PRINCIPLES.md, Vocabulary). */
export const ANYONE_WITH_FILE = "Anyone who has this file can open it.";

/**
 * File ▸ Export as ▸ Interactive HTML…: one self-contained file to open in a browser or host where the team
 * already controls access. Simple by default (Download); the title, banner, theme and simulations sit behind
 * Options.
 */
export function HtmlExportDialog({ diagram, onClose }: { diagram: DiagramFile; onClose: () => void }) {
  const sims = diagram.simulations ?? [];
  const [title, setTitle] = useState(diagram.title);
  const [banner, setBanner] = useState("");
  // The app's theme now is the file's default.
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  const [kept, setKept] = useState<string[]>(() => sims.map((s) => s.id));
  const [start, setStart] = useState<string>(sims[0]?.id ?? "");
  // The viewer downloads while the person reads the dialog.
  useEffect(preloadTemplate, []);

  const keptSims = sims.filter((s) => kept.includes(s.id));
  const startSim = keptSims.find((s) => s.id === start);
  const summary = [
    theme === "dark" ? "Dark theme" : "Light theme",
    sims.length ? `${keptSims.length} simulation${keptSims.length === 1 ? "" : "s"}` : "no simulations",
    startSim ? `plays “${startSim.title}” when opened` : sims.length ? "opens without playing" : "",
    banner.trim() ? "with a banner" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const toggle = (id: string, on: boolean) =>
    setKept((k) => (on ? sims.map((s) => s.id).filter((x) => x === id || k.includes(x)) : k.filter((x) => x !== id)));

  return (
    <Dialog
      title="Interactive HTML"
      subtitle="One file with the diagram and its simulations, to open in any browser. It makes no requests and needs no internet."
      icon={<Glyph name="play" />}
      onClose={onClose}
      testId="html-export-dialog"
      width={480}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="html-export-cancel">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              void exportInteractiveHtml(diagram, {
                title: title.trim() || diagram.title,
                banner: banner.trim() || undefined,
                theme,
                simulations: keptSims.map((s) => s.id),
                startSimulation: startSim?.id ?? null,
              });
            }}
            data-testid="html-export-download"
            data-autofocus
          >
            <Glyph name="download" size={14} /> Download HTML
          </button>
        </>
      }
    >
      <div className="ix-meta-row" data-testid="html-export-summary">
        {summary}
      </div>
      <div className="ix-callout" data-testid="html-export-anyone">
        <Glyph name="info" size={15} />
        <span>
          <strong>{ANYONE_WITH_FILE}</strong> Keep it where your team already controls access, such as SharePoint,
          Confluence or a private repository.
        </span>
      </div>
      <Disclosure testId="html-export-options">
        <div className="ix-form">
          <label className="ix-form-label" htmlFor="html-export-title">
            Title
          </label>
          <input
            id="html-export-title"
            className="ix-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            data-testid="html-export-title"
          />
          <label className="ix-form-label" htmlFor="html-export-banner">
            Banner
          </label>
          <input
            id="html-export-banner"
            className="ix-input"
            value={banner}
            onChange={(e) => setBanner(e.target.value)}
            placeholder="e.g. Confidential: internal use only"
            maxLength={300}
            data-testid="html-export-banner"
          />
          <span className="ix-form-label">Theme</span>
          <div className="ix-seg" role="radiogroup" aria-label="Theme">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                className={theme === t ? "is-on" : ""}
                onClick={() => setTheme(t)}
                data-testid={`html-export-theme-${t}`}
              >
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          {sims.length > 0 && (
            <>
              <span className="ix-form-label ix-form-top">Simulations</span>
              <div className="ix-checks" role="group" aria-label="Simulations to include">
                {sims.map((s) => (
                  <label key={s.id} className="ix-check">
                    <input
                      type="checkbox"
                      checked={kept.includes(s.id)}
                      onChange={(e) => toggle(s.id, e.target.checked)}
                      data-testid={`html-export-sim-${s.id}`}
                    />
                    {s.title}
                  </label>
                ))}
              </div>
              <label className="ix-form-label" htmlFor="html-export-start">
                When opened
              </label>
              <select
                id="html-export-start"
                className="ix-input"
                value={startSim?.id ?? ""}
                onChange={(e) => setStart(e.target.value)}
                data-testid="html-export-start"
              >
                <option value="">Show the diagram, not playing</option>
                {keptSims.map((s) => (
                  <option key={s.id} value={s.id}>
                    Play “{s.title}”
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </Disclosure>
    </Dialog>
  );
}
