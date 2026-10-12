import { Suspense, useEffect, useRef, useState } from "react";
import type { DiagramFile } from "../../model/types";
import { examples, loadExample } from "../../examples";
import { LazyCanvasView as CanvasView, preloadCanvasView } from "../../canvas/loadCanvasView";
import { decodeShare, sharePayloadFromHash } from "../share";
import { encryptedPayloadFromHash, parseEncrypted } from "../passwordLink";
import { UnlockDialog } from "../ui/lazyDialogs";
import { Glyph } from "../ui/glyphs";
import { notify } from "../ui/toast";

// ?embed=1 — a clean, read-only viewer for <iframe> embeds: no top bar, fitted to the frame, pan and
// zoom only, plus a subtle "Open in Live Diagrams" link. The diagram comes from `example=<slug>` or a
// share payload in the fragment (`#d=...`). `live=1&sim=<id>` are passed through untouched for the
// live view. A password link's fragment (`#e=...`) asks for the password inside the frame and keeps its
// fragment (the host page's <iframe src> holds it anyway, and the frame must stay reloadable).

type State =
  | { status: "loading" }
  | { status: "ready"; diagram: DiagramFile; key: string; openHref: string }
  /** A password link: `asking` while the prompt is open; `session` numbers that prompt. */
  | { status: "locked"; token: string; asking: boolean; session?: number }
  /** `toast`: also announce the error (a failed download, not a bad link). */
  | { status: "error"; message: string; toast?: boolean };

function resolve(): Promise<State> {
  const params = new URLSearchParams(window.location.search);
  const base = `${window.location.origin}${window.location.pathname}`;
  const token = encryptedPayloadFromHash(window.location.hash);
  if (token) {
    try {
      parseEncrypted(token);
    } catch (err) {
      return Promise.resolve({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
    return Promise.resolve({ status: "locked", token, asking: true });
  }
  const payload = sharePayloadFromHash(window.location.hash);
  if (payload) {
    return decodeShare(payload).then(
      (diagram) => ({
        status: "ready",
        diagram,
        key: `d:${payload.length}:${payload.slice(-16)}`,
        openHref: `${base}#d=${payload}`,
      }),
      (err) => ({ status: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }
  const slug = params.get("example");
  const ex = slug ? examples.find((e) => e.slug === slug) : undefined;
  if (ex)
    return loadExample(ex.slug).then(
      (diagram): State => ({
        status: "ready",
        diagram,
        key: `ex:${ex.slug}`,
        openHref: `${base}?view=canvas&example=${encodeURIComponent(ex.slug)}`,
      }),
      (): State => ({
        status: "error",
        message: "Couldn't load that example. Check your connection and reload.",
        toast: true,
      }),
    );
  return Promise.resolve({
    status: "error",
    message: slug
      ? `There's no example called “${slug}”.`
      : "This embed doesn't say which diagram to show. Copy the embed code again from Export → Embed.",
  });
}

export function EmbedView() {
  const [state, setState] = useState<State>({ status: "loading" });
  // Only the latest navigation may apply: a slow example download (or a password unlock) that finishes
  // after a newer hash change, or after unmounting, is dropped, toast included.
  const navigation = useRef(0);
  // The password prompt's session: closing it (Cancel, Esc) or a new prompt drops an unlock in flight.
  const unlockSession = useRef(0);
  useEffect(() => {
    // The diagram is always shown on the canvas: fetch its code while the diagram resolves.
    preloadCanvasView();
    const nav = navigation;
    const prompt = unlockSession;
    const load = () => {
      const request = ++navigation.current;
      void resolve().then((s) => {
        if (request !== navigation.current) return;
        if (s.status === "error" && s.toast) notify(s.message, { kind: "error" });
        setState(s.status === "locked" ? { ...s, session: ++unlockSession.current } : s);
      });
    };
    load();
    window.addEventListener("hashchange", load);
    return () => {
      nav.current++;
      prompt.current++;
      window.removeEventListener("hashchange", load);
    };
  }, []);

  return (
    <div className="ix-embed" data-testid="embed-view">
      {state.status === "ready" ? (
        <>
          <Suspense fallback={<div className="ix-embed-msg">Loading…</div>}>
            <CanvasView
              key={state.key}
              slug="embed"
              initial={state.diagram}
              readOnly
              presenting={false}
              onExitPresent={() => {}}
            />
          </Suspense>
          <a
            className="ix-embed-open"
            href={state.openHref}
            target="_blank"
            rel="noopener"
            data-testid="embed-open-in-app"
            title="Open an editable copy in Live Diagrams"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <rect x="1.5" y="3" width="8" height="6" rx="2" fill="currentColor" opacity=".55" />
              <rect x="14.5" y="15" width="8" height="6" rx="2" fill="currentColor" />
              <path
                d="M9.5 6h3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 0 2.5 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Open in Live Diagrams
            <Glyph name="external" size={12} />
          </a>
        </>
      ) : state.status === "locked" ? (
        <div className="ix-embed-msg" data-testid="embed-locked">
          <div className="ix-embed-locked">
            <span>This diagram is password-protected.</span>
            <button
              className="btn btn-primary"
              onClick={() => setState({ ...state, asking: true, session: ++unlockSession.current })}
              data-testid="embed-unlock"
            >
              <Glyph name="lock" size={14} /> Enter password
            </button>
          </div>
          {state.asking && (
            <UnlockDialog
              key={state.session}
              unlock={async (password) => {
                const request = navigation.current;
                const session = state.session;
                const { decodeEncryptedShare } = await import("../shareCrypto");
                const diagram = await decodeEncryptedShare(state.token, password);
                if (request !== navigation.current || session !== unlockSession.current) return;
                const base = `${window.location.origin}${window.location.pathname}`;
                setState({
                  status: "ready",
                  diagram,
                  key: `e:${state.token.length}:${state.token.slice(-16)}`,
                  // Still encrypted: opening it in the app asks for the password again.
                  openHref: `${base}#e=${state.token}`,
                });
              }}
              onClose={() => {
                unlockSession.current++;
                setState({ ...state, asking: false });
              }}
            />
          )}
        </div>
      ) : (
        <div
          className="ix-embed-msg"
          role={state.status === "error" ? "alert" : "status"}
          data-testid={state.status === "error" ? "embed-error" : "embed-loading"}
        >
          {state.status === "error" ? state.message : "Loading…"}
        </div>
      )}
    </div>
  );
}
