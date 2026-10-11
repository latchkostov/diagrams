import { lazy, Suspense, useEffect, useState } from "react";
import type { DiagramFile } from "../../model/types";
import { examples, loadExample } from "../../examples";
import { decodeShare, sharePayloadFromHash } from "../share";
import { Glyph } from "../ui/glyphs";
import { notify } from "../ui/toast";

// ?embed=1 — a clean, read-only viewer for <iframe> embeds: no top bar, fitted to the frame, pan and
// zoom only, plus a subtle "Open in Diagrams" link. The diagram comes from `example=<slug>` or a
// share payload in the fragment (`#d=...`). `live=1&sim=<id>` are passed through untouched for the
// live view.

const CanvasView = lazy(() => import("../../canvas/CanvasView").then((m) => ({ default: m.CanvasView })));

type State =
  | { status: "loading" }
  | { status: "ready"; diagram: DiagramFile; key: string; openHref: string }
  | { status: "error"; message: string };

function resolve(): Promise<State> {
  const params = new URLSearchParams(window.location.search);
  const base = `${window.location.origin}${window.location.pathname}`;
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
      () => {
        const message = "Couldn't load that example. Check your connection and reload.";
        notify(message, { kind: "error" });
        return { status: "error", message };
      },
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
  useEffect(() => {
    let live = true;
    const load = () => void resolve().then((s) => live && setState(s));
    load();
    window.addEventListener("hashchange", load);
    return () => {
      live = false;
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
            title="Open an editable copy in Diagrams"
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
            Open in Diagrams
            <Glyph name="external" size={12} />
          </a>
        </>
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
