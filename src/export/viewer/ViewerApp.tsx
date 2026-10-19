import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CanvasView, type CanvasViewerOptions } from "../../canvas/CanvasView";
import { ViewerControls } from "./ViewerControls";
import { Toaster } from "../../interop/ui/Toaster";
import { Glyph } from "../../interop/ui/glyphs";
import { CANT_UNLOCK_HERE, UnlockError } from "../lock";
import { addIcons } from "./iconUrls";
import { readPayload, unlockPayload, type LockedFile, type OpenPayload } from "./payload";

// The exported file's page: the diagram on a read-only canvas (the embed's, with live playback), an optional
// banner above it and a one-line footer below. Nothing here leaves the page: no links out, no storage, no AI.
// A password-protected file opens on its password prompt (LockedView) and shows the diagram once it's unlocked.

/** "12 October 2026" in the reader's locale, from "2026-10-12". */
function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * A password-protected file's first screen: one field, keyboard first (focused, Enter opens), checked in the page.
 * A wrong password says so and keeps what was typed, selected, to fix or retype. There's no lockout (the file is
 * offline, so one couldn't hold); each try costs the key derivation's 600,000 PBKDF2 iterations instead.
 */
function LockedView({ locked, onOpen }: { locked: LockedFile; onOpen: (payload: OpenPayload) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputId = useId();
  useEffect(() => input.current?.focus(), []);
  // WebCrypto is there in a secure context only (https://, a file opened from disk): say so before asking.
  const supported = !!globalThis.crypto?.subtle;

  const submit = async () => {
    if (!password || busy || !supported) return;
    setBusy(true);
    setError(undefined);
    try {
      onOpen(await unlockPayload(locked, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      if (err instanceof UnlockError && err.wrong)
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
    }
  };

  return (
    <div className="xv" data-testid="html-viewer-locked">
      <main className="xv-lock" aria-labelledby={titleId}>
        {/* No <form>: a frame sandboxed without allow-forms (as a wiki may frame the file) never submits one. */}
        <div className="xv-lock-card" aria-busy={busy} data-testid="viewer-lock">
          <span className="xv-lock-icon" aria-hidden>
            <Glyph name="lock" size={20} />
          </span>
          <h1 id={titleId} className="xv-lock-title">
            This diagram is password-protected
          </h1>
          <p id={hintId} className="xv-lock-hint">
            Enter the password you were given. It&rsquo;s checked in this file; nothing is sent anywhere.
          </p>
          {!supported && (
            <p className="ix-error" role="alert" data-testid="viewer-password-unsupported">
              {CANT_UNLOCK_HERE}
            </p>
          )}
          <label className="ix-form-label" htmlFor={inputId}>
            Password
          </label>
          <div className="xv-lock-row">
            <input
              ref={input}
              id={inputId}
              className="ix-input"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                void submit();
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
              aria-describedby={error ? `${errorId} ${hintId}` : hintId}
              data-testid="viewer-password-input"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={!password || busy || !supported}
              data-testid="viewer-password-submit"
            >
              {busy && <Glyph name="spinner" size={14} />} {busy ? "Unlocking…" : "Open"}
            </button>
          </div>
          {error && (
            <p className="ix-error" role="alert" id={errorId} data-testid="viewer-password-error">
              {error}
            </p>
          )}
        </div>
      </main>
      <footer className="xv-foot" data-testid="viewer-footer">
        <span>Exported from Live Diagrams. Read-only.</span>
      </footer>
    </div>
  );
}

export function ViewerApp() {
  const [payload, setPayload] = useState(readPayload);
  const [unlocked, setUnlocked] = useState(false);
  if (payload.locked)
    return (
      <LockedView
        locked={payload.locked}
        onOpen={(open) => {
          // Before the canvas first renders: its icons. The page keeps its neutral title: browsers keep a page's
          // title in their history (and sync it), and the title is part of what the password protects.
          addIcons(open.icons);
          setUnlocked(true);
          setPayload(open);
        }}
      />
    );
  if (!payload.ok)
    return (
      <div className="xv" data-testid="html-viewer">
        <p className="xv-error" role="alert" data-testid="viewer-error">
          {payload.error}
        </p>
      </div>
    );
  // Unlocked: the keyboard moves on to the diagram, and a screen reader hears its name.
  return <Viewer payload={payload} focus={unlocked} />;
}

function Viewer({ payload, focus }: { payload: OpenPayload; focus?: boolean }) {
  const hintId = useId();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) main.current?.focus();
  }, [focus]);
  const viewer = useMemo((): CanvasViewerOptions => {
    const sim = payload.options.startSimulation;
    return {
      live: { live: !!sim, sim, speed: null, paused: false },
      // A page of its own: the wheel pans, as in the app. Framed inside someone's page, it scrolls that page.
      wheel: window.self === window.top,
      controls: <ViewerControls hintId={hintId} />,
    };
  }, [payload, hintId]);

  const { diagram, options } = payload;
  return (
    <div className="xv" data-testid="html-viewer" data-theme-choice={options.theme}>
      {options.banner && (
        <div className="xv-banner" role="note" data-testid="viewer-banner">
          {options.banner}
        </div>
      )}
      <main
        ref={main}
        tabIndex={-1}
        className="xv-canvas ix-embed"
        aria-label={`Diagram: ${diagram.title}`}
        aria-describedby={hintId}
        data-testid="viewer-canvas"
      >
        <CanvasView
          slug="html-export"
          initial={diagram}
          readOnly
          presenting={false}
          onExitPresent={() => {}}
          viewer={viewer}
        />
      </main>
      <footer className="xv-foot" data-testid="viewer-footer">
        <span>
          Exported from Live Diagrams{options.exportedOn ? ` on ${formatDay(options.exportedOn)}` : ""}. Read-only.
        </span>
        <span id={hintId} className="xv-keys">
          Drag or arrow keys to pan, + and − to zoom, Shift+1 to fit.
        </span>
      </footer>
      <Toaster />
    </div>
  );
}
