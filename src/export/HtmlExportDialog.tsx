import { useEffect, useRef, useState } from "react";
import type { DiagramFile } from "../model/types";
import { Dialog } from "../interop/ui/Dialog";
import { Disclosure } from "../interop/ui/dialogs";
import { Glyph } from "../interop/ui/glyphs";
import { PasswordField } from "../interop/ui/PasswordField";
import { MIN_PASSWORD_LENGTH } from "../interop/encryptedToken";
import { exportInteractiveHtml, preloadTemplate } from "./exportHtml";
import "./htmlExport.css";

const THEMES = ["light", "dark"] as const;

/** The one line every Interactive HTML export shows (docs/UX-PRINCIPLES.md, Vocabulary). */
export const ANYONE_WITH_FILE = "Anyone who has this file can open it.";
/** …and the line it shows instead with Require a password on. */
export const ONLY_WITH_PASSWORD = "Only people with the password can open it.";

/**
 * File ▸ Export as ▸ Interactive HTML…: one self-contained file to open in a browser or host where the team
 * already controls access. Simple by default (Download); the title, banner, theme and simulations sit behind
 * Options. **Require a password** (off by default) encrypts the file (./lock.ts) with the same field as Copy link
 * with password… (PasswordField).
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
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const passwordInput = useRef<HTMLInputElement>(null);
  // Turning it on puts the keyboard in the field.
  useEffect(() => {
    if (locked) passwordInput.current?.focus();
  }, [locked]);
  const ready = !locked || password.length >= MIN_PASSWORD_LENGTH;
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
  // The theme radio group's keys: arrows (and Home, End) move and select. A native listener, because the dialog
  // keeps keys from bubbling past its panel (src/interop/ui/Dialog.tsx), so React's onKeyDown never sees them.
  // (A ref callback: the group mounts only when Options opens. React 19 runs its cleanup on change.)
  const themeKeys = (group: HTMLDivElement | null) => {
    if (!group) return;
    const onKey = (e: KeyboardEvent) => {
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (step === undefined && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const at = e.key === "Home" ? 0 : e.key === "End" ? THEMES.length - 1 : THEMES.indexOf(theme) + step;
      const next = THEMES[(at + THEMES.length) % THEMES.length];
      setTheme(next);
      group.querySelector<HTMLElement>(`[data-testid="html-export-theme-${next}"]`)?.focus();
    };
    group.addEventListener("keydown", onKey);
    return () => group.removeEventListener("keydown", onKey);
  };
  const download = () => {
    if (!ready) return;
    onClose();
    void exportInteractiveHtml(diagram, {
      title: title.trim() || diagram.title,
      banner: banner.trim() || undefined,
      theme,
      simulations: keptSims.map((s) => s.id),
      startSimulation: startSim?.id ?? null,
      password: locked ? password : undefined,
    });
  };
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
            disabled={!ready}
            onClick={download}
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
      {locked ? (
        <div className="ix-callout" data-testid="html-export-protected">
          <Glyph name="lock" size={15} />
          <span>
            <strong>{ONLY_WITH_PASSWORD}</strong> Send the password separately, not with the file.
          </span>
        </div>
      ) : (
        <div className="ix-callout" data-testid="html-export-anyone">
          <Glyph name="info" size={15} />
          <span>
            <strong>{ANYONE_WITH_FILE}</strong> Keep it where your team already controls access, such as SharePoint,
            Confluence or a private repository.
          </span>
        </div>
      )}
      <label className="ix-check">
        <input
          type="checkbox"
          checked={locked}
          onChange={(e) => setLocked(e.target.checked)}
          data-testid="html-export-password-toggle"
        />
        Require a password
      </label>
      {locked && (
        <form
          className="ix-password ix-html-password"
          onSubmit={(e) => {
            // Enter in the field downloads, as Enter in Copy link with password… copies.
            e.preventDefault();
            download();
          }}
          data-testid="html-export-password"
        >
          <PasswordField
            value={password}
            onChange={setPassword}
            testId="html-export-password"
            inputRef={passwordInput}
          />
          <p className="ix-html-password-note" data-testid="html-export-password-note">
            Encrypts the whole diagram, title included; only the file&rsquo;s size shows. The password is never stored
            or sent and can&rsquo;t be recovered: if it&rsquo;s lost, export again.
          </p>
        </form>
      )}
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
          {/* A radio group: one Tab stop (the checked one), arrow keys move and select. */}
          <div ref={themeKeys} className="ix-seg" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={theme === t}
                tabIndex={theme === t ? 0 : -1}
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
