import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { DiagramFile } from "../../model/types";
import { embedSnippet, embedUrl, encodeShare, SHARE_WARN_LENGTH, shareUrl } from "../share";
import { PRIVATE_SHARE_MESSAGE } from "../../lib/localOnly";
import { SHARE_LINKS } from "../../lib/deployment";
import { hostEmbedUrl, iframeSnippet, SNIPPET_PROTOCOL, webComponentSnippet } from "../embed/hostSnippets";

/**
 * A link dialog's actions ask the privacy gate when they act (the dialog may have been open a while).
 * Refused: the dialog closes and says why.
 */
function gate(allowed: (() => boolean) | undefined, onClose: () => void): boolean {
  if (!allowed || allowed()) return true;
  onClose();
  toast.info(PRIVATE_SHARE_MESSAGE);
  return false;
}
import { detectFormat, FORMAT_LABEL } from "../formats";
import { Dialog } from "./Dialog";
import { copyText } from "./copyText";
import { Glyph } from "./glyphs";
import { clearDevice } from "../../lib/clearDevice";
import { toast } from "./toast";

const kb = (n: number) => (n < 1024 ? `${n} characters` : `${(n / 1024).toFixed(1)}k characters`);

/**
 * Moves focus to `target` once `ready`, if the dialog's panel still holds it (its autofocus target was disabled
 * when it opened, so the panel took focus). Focus the person moved elsewhere stays put.
 */
function useFocusWhenReady(target: RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => {
    const el = target.current;
    if (ready && el && document.activeElement === el.closest("[role=dialog]")) el.focus();
  }, [target, ready]);
}

/**
 * The embed preview is the real viewer, so it stays a Tab stop. Esc inside it (the viewer is this site's own page)
 * backs out one level, to the preview's frame in the dialog, so the dialog's own Esc works next and Tab carries on
 * from there. A ref callback for the iframe; `back` moves focus out.
 */
function useEscapeBackOut(back: () => void) {
  const backRef = useRef(back);
  useLayoutEffect(() => {
    backRef.current = back;
  });
  return useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) return;
    const seen = new WeakSet<Document>();
    const attach = () => {
      // Each page the frame loads gets its own listener; another origin's page (never ours) returns null.
      const doc = frame.contentDocument;
      if (!doc?.defaultView || seen.has(doc)) return;
      seen.add(doc);
      doc.defaultView.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Escape") backRef.current();
        },
        true,
      );
    };
    attach();
    frame.addEventListener("load", attach);
    return () => frame.removeEventListener("load", attach);
  }, []);
}

/** Share link: the diagram compressed into the URL fragment. */
export function ShareDialog({
  diagram,
  allowed,
  onPasswordLink,
  onClose,
}: {
  diagram: DiagramFile;
  /** Whether its document may still be shared as a link (asked again by every action). */
  allowed?: () => boolean;
  /** Link with password… (the same diagram, encrypted). */
  onPasswordLink?: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    encodeShare(diagram).then(
      (p) => live && setUrl(shareUrl(p)),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [diagram]);
  const long = !!url && url.length > SHARE_WARN_LENGTH;
  const canShare = typeof navigator.share === "function";
  const copyButton = useRef<HTMLButtonElement>(null);
  useFocusWhenReady(copyButton, !!url);

  const copy = async () => {
    if (!gate(allowed, onClose)) return;
    if (url && (await copyText(url))) toast.success("Share link copied. Anyone with the link can open the diagram.");
    else toast.error("Couldn't copy automatically. Select the link and copy it.");
  };

  return (
    <Dialog
      title="Share link"
      subtitle="Anyone with the link can open it and keep an editable copy."
      icon={<Glyph name="link" />}
      onClose={onClose}
      testId="share-link-dialog"
      footer={
        <>
          {canShare && url && (
            <button
              className="btn"
              onClick={() => {
                if (gate(allowed, onClose)) navigator.share({ title: diagram.title, url }).catch(() => {});
              }}
              data-testid="share-link-native"
            >
              <Glyph name="share" size={14} /> Share…
            </button>
          )}
          <span className="ix-grow" />
          {url && (
            <a
              className="btn"
              href={url}
              target="_blank"
              rel="noopener"
              onClick={(e) => {
                if (!gate(allowed, onClose)) e.preventDefault();
              }}
              data-testid="share-link-open"
            >
              <Glyph name="external" size={14} /> Open
            </a>
          )}
          <button
            ref={copyButton}
            className="btn btn-primary"
            onClick={copy}
            disabled={!url}
            data-testid="share-link-copy"
            data-autofocus
          >
            <Glyph name="copy" size={14} /> Copy link
          </button>
        </>
      }
    >
      {error ? (
        <p className="ix-error" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="ix-field-row">
            <input
              className="ix-input ix-mono"
              readOnly
              value={url ?? "Compressing…"}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share link"
              data-testid="share-link-url"
            />
          </div>
          <div className="ix-meta-row">
            <span data-testid="share-link-length" className={long ? "ix-warn-text" : undefined}>
              {url ? kb(url.length) : "…"}
            </span>
            <span>·</span>
            <span>
              {diagram.nodes.length} nodes, {diagram.edges.length} edges
              {diagram.simulations?.length
                ? `, ${diagram.simulations.length} simulation${diagram.simulations.length === 1 ? "" : "s"}`
                : ""}
            </span>
            {onPasswordLink && (
              <>
                <span className="ix-grow" />
                <button
                  className="link-btn"
                  onClick={() => {
                    if (gate(allowed, onClose)) onPasswordLink();
                  }}
                  data-testid="share-link-password"
                >
                  <Glyph name="lock" size={13} /> Link with password…
                </button>
              </>
            )}
          </div>
          {long && (
            <div className="ix-callout ix-callout-warn" data-testid="share-link-warning">
              <Glyph name="alert" size={15} />
              <span>
                This link is long ({kb(url!.length)}). Some chat apps and email clients cut long links off. For big
                diagrams, share the <strong>.diagram.json</strong> file instead (or save it to Google Drive and share
                that).
              </span>
            </div>
          )}
          <div className="ix-callout">
            <Glyph name="info" size={15} />
            <span>
              The diagram lives inside the link itself (after the #), so it's never uploaded anywhere. Opening it never
              overwrites the recipient's own diagrams.
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}

/**
 * A segmented radio group's keys, as a ref callback: arrows (and Home, End) move to the next choice and
 * select it. With `tabIndex` 0 on the checked radio only, the group is one Tab stop. A native listener, because
 * the dialog keeps keys from bubbling past its panel (Dialog.tsx), so React's onKeyDown never sees them (the same
 * pattern as the Interactive HTML dialog's Theme).
 */
function radioKeys<T extends string>(
  values: readonly T[],
  current: T,
  select: (value: T) => void,
  testId: (value: T) => string,
) {
  return (group: HTMLDivElement | null) => {
    if (!group) return;
    const onKey = (e: KeyboardEvent) => {
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (step === undefined && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const at = values.indexOf(current);
      const next =
        e.key === "Home"
          ? values[0]
          : e.key === "End"
            ? values[values.length - 1]
            : values[(Math.max(at, 0) + step + values.length) % values.length];
      select(next);
      group.querySelector<HTMLElement>(`[data-testid="${testId(next)}"]`)?.focus();
    };
    group.addEventListener("keydown", onKey);
    return () => group.removeEventListener("keydown", onKey);
  };
}

/** Where an embed's diagram comes from: a public example by name, the diagram in the URL, or the host's page. */
type EmbedSource = "example" | "inline" | "host";
const FORMATS = ["component", "iframe"] as const;

/**
 * The host-supplied embed's preview: the same viewer, handed the diagram with postMessage (never in its URL),
 * exactly as a host page does.
 */
function HostPreview({
  diagram,
  simulation,
  frameRef,
}: {
  diagram: DiagramFile;
  simulation: string;
  /** The dialog's (Esc backs out of the preview). */
  frameRef: ReturnType<typeof useEscapeBackOut>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const refs = useCallback(
    (el: HTMLIFrameElement | null) => {
      frame.current = el;
      return frameRef(el);
    },
    [frameRef],
  );
  const [src] = useState(() => hostEmbedUrl(window.location.origin));
  const ready = useRef(false);
  useEffect(() => {
    const viewer = new URL(src).origin;
    const send = () =>
      frame.current?.contentWindow?.postMessage(
        {
          protocol: SNIPPET_PROTOCOL,
          type: "load",
          diagram,
          options: simulation ? { simulation, autoplay: true } : {},
        },
        viewer,
      );
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== viewer) return;
      if (e.data?.protocol !== SNIPPET_PROTOCOL || e.data.type !== "ready") return;
      ready.current = true;
      send();
    };
    window.addEventListener("message", onMessage);
    if (ready.current) send();
    return () => window.removeEventListener("message", onMessage);
  }, [src, diagram, simulation]);
  return <iframe ref={refs} src={src} title="Embed preview" data-testid="embed-preview" />;
}

/**
 * Embed code: an <iframe> of the read-only viewer, or a viewer your own app supplies, with a live preview. Share…
 * opens it for one kind: `private` (Embed in your app: the host-supplied embed only) or `public` (Embed on a public
 * page: in the link, or an example by name).
 */
export function EmbedDialog({
  diagram,
  scope,
  example,
  allowed,
  privateDiagram = false,
  fileName,
  onDownload,
  onClose,
}: {
  diagram: DiagramFile;
  scope: "private" | "public";
  example?: string;
  /** Whether its document may still be shared as a link (asked again by every action). */
  allowed?: () => boolean;
  /** With `private`: the diagram is private, so this is the only embed it gets (its subtitle says so). */
  privateDiagram?: boolean;
  /** The diagram file's name, as File > Diagram file saves it. */
  fileName: string;
  /** Saves the diagram file, for the host to serve. */
  onDownload: () => void;
  onClose: () => void;
}) {
  // The kind is the one Share… opened: Embed in your app is the host-supplied embed only, and so is every embed in a
  // copy deployed without share links (src/lib/deployment.ts). Embed on a public page never offers it.
  const privateOnly = scope === "private" || !SHARE_LINKS;
  const [payload, setPayload] = useState<string>();
  const [chosen, setChosen] = useState<EmbedSource>(privateOnly ? "host" : example ? "example" : "inline");
  const source: EmbedSource = privateOnly ? "host" : chosen;
  const host = source === "host";
  const [height, setHeight] = useState(480);
  /** The host-supplied embed sizes itself to the diagram by default (0). */
  const [hostHeight, setHostHeight] = useState(0);
  const [sim, setSim] = useState("");
  const [format, setFormat] = useState<"component" | "iframe">("component");
  const [srcJson, setSrcJson] = useState(`/diagrams/${fileName}`);
  useEffect(() => {
    // A private diagram is never encoded: nothing of it goes in a URL.
    if (privateOnly) return;
    let live = true;
    encodeShare(diagram).then((p) => live && setPayload(p));
    return () => {
      live = false;
    };
  }, [diagram, privateOnly]);
  const src = useMemo(() => {
    if (host) return undefined;
    if (source === "example" && example) return embedUrl({ example, live: !!sim, sim: sim || undefined });
    return payload ? embedUrl({ payload, live: !!sim, sim: sim || undefined }) : undefined;
  }, [host, source, example, payload, sim]);
  const hostOptions = {
    srcJson: srcJson.trim() || `/diagrams/${fileName}`,
    title: diagram.title,
    simulation: sim || undefined,
    height: hostHeight || undefined,
  };
  const snippet = host
    ? format === "component"
      ? webComponentSnippet(hostOptions)
      : iframeSnippet(hostOptions)
    : src
      ? embedSnippet(src, { title: diagram.title, height })
      : "";
  const copyButton = useRef<HTMLButtonElement>(null);
  useFocusWhenReady(copyButton, !!snippet);
  const previewArea = useRef<HTMLDivElement>(null);
  const previewFrame = useEscapeBackOut(() => previewArea.current?.focus());
  const [previewSrc, setPreviewSrc] = useState<string>();
  useEffect(() => {
    // Debounce so flipping options doesn't reload the preview on every click.
    const t = setTimeout(() => setPreviewSrc(src), 250);
    return () => clearTimeout(t);
  }, [src]);

  const copy = async () => {
    // The host-supplied embed's code holds nothing of the diagram: there's no link to gate.
    if (!host && !gate(allowed, onClose)) return;
    if (snippet && (await copyText(snippet))) toast.success("Embed code copied.");
    else toast.error("Couldn't copy automatically. Select the code and copy it.");
  };

  // The public embed's two sources, when the diagram is an unedited public example; one source shows no choice.
  const sources: EmbedSource[] = privateOnly ? ["host"] : example ? ["example", "inline"] : ["inline"];
  const sourceButton = (value: EmbedSource, label: string) => (
    <button
      role="radio"
      aria-checked={source === value}
      tabIndex={source === value ? 0 : -1}
      className={source === value ? "is-on" : ""}
      onClick={() => setChosen(value)}
      data-testid={`embed-source-${value}`}
    >
      {label}
    </button>
  );

  return (
    <Dialog
      title="Embed code"
      subtitle={
        privateDiagram
          ? "A private diagram embeds only where your own app supplies it. Viewers can pan, zoom and play it."
          : host
            ? "Show this diagram inside your own app or intranet. Viewers can pan, zoom and play it, not edit it."
            : "Paste this into a blog post, wiki or docs page. Viewers can pan and zoom, not edit."
      }
      icon={<Glyph name="code" />}
      onClose={onClose}
      testId="embed-dialog"
      width={720}
      footer={
        <>
          {host && (
            <button
              className="btn"
              onClick={onDownload}
              title="Save the diagram file to serve from your app"
              data-testid="embed-host-download"
            >
              <Glyph name="download" size={14} /> Diagram file
            </button>
          )}
          <span className="ix-grow" />
          {src && (
            <a
              className="btn"
              href={src}
              target="_blank"
              rel="noopener"
              onClick={(e) => {
                if (!gate(allowed, onClose)) e.preventDefault();
              }}
              data-testid="embed-open"
            >
              <Glyph name="external" size={14} /> Open viewer
            </a>
          )}
          <button
            ref={copyButton}
            className="btn btn-primary"
            onClick={copy}
            disabled={!snippet}
            data-testid="embed-copy"
            data-autofocus
          >
            <Glyph name="copy" size={14} /> Copy code
          </button>
        </>
      }
    >
      {SHARE_LINKS && sources.length > 1 && (
        <div
          ref={radioKeys(sources, source, setChosen, (v) => `embed-source-${v}`)}
          className="ix-seg"
          role="radiogroup"
          aria-label="Where the diagram comes from"
        >
          {sourceButton("example", "Example by name")}
          {sourceButton("inline", "In the link")}
        </div>
      )}
      {source === "inline" && (
        <div className="ix-callout" data-testid="embed-inline-note">
          <Glyph name="info" size={15} />
          <span>
            <strong>Anyone who can see the page can open this diagram.</strong> It&apos;s inside the code. For a work
            diagram, use Share… ▸ Embed in your app.
          </span>
        </div>
      )}
      {host && (
        <div className="ix-callout" data-testid="embed-host-note">
          <Glyph name="lock" size={15} />
          <span>
            <strong>The diagram never leaves your app. Live Diagrams only provides the viewer.</strong> Serve the
            diagram file from your app, behind its own sign-in; your page fetches it and hands it to the viewer. It's
            never in a URL and never sent to livediagrams.dev.
          </span>
        </div>
      )}
      {host && (
        <div
          ref={radioKeys(FORMATS, format, setFormat, (v) => `embed-host-format-${v}`)}
          className="ix-seg"
          role="radiogroup"
          aria-label="Code"
        >
          {FORMATS.map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={format === value}
              tabIndex={format === value ? 0 : -1}
              className={format === value ? "is-on" : ""}
              onClick={() => setFormat(value)}
              data-testid={`embed-host-format-${value}`}
            >
              {value === "component" ? "Web component" : "iframe + postMessage"}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="ix-input ix-mono ix-code"
        readOnly
        value={snippet}
        rows={host ? (format === "iframe" ? 10 : 3) : 4}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Embed code"
        data-testid="embed-snippet"
      />
      <div
        ref={previewArea}
        className="ix-preview"
        tabIndex={-1}
        aria-label="Embed preview"
        style={{ height: host ? 300 : Math.min(height, source === "inline" ? 290 : 340) }}
        data-testid="embed-preview-area"
      >
        {host ? (
          <HostPreview diagram={diagram} simulation={sim} frameRef={previewFrame} />
        ) : previewSrc ? (
          <iframe
            ref={previewFrame}
            src={previewSrc}
            title="Embed preview"
            loading="lazy"
            data-testid="embed-preview"
          />
        ) : (
          <span className="ix-muted">Preparing preview…</span>
        )}
      </div>
      <Disclosure testId="embed-options">
        <div className="ix-options">
          {host && (
            <label className="ix-select ix-embed-src">
              <span>File in your app</span>
              <input
                value={srcJson}
                onChange={(e) => setSrcJson(e.target.value)}
                spellCheck={false}
                data-testid="embed-host-src"
              />
            </label>
          )}
          <label className="ix-select">
            <span>Height</span>
            {host ? (
              <select
                value={hostHeight}
                onChange={(e) => setHostHeight(Number(e.target.value))}
                data-testid="embed-height"
              >
                <option value={0}>Fits the diagram</option>
                {[360, 480, 640, 800].map((h) => (
                  <option key={h} value={h}>
                    {h}px
                  </option>
                ))}
              </select>
            ) : (
              <select value={height} onChange={(e) => setHeight(Number(e.target.value))} data-testid="embed-height">
                {[360, 480, 640, 800].map((h) => (
                  <option key={h} value={h}>
                    {h}px
                  </option>
                ))}
              </select>
            )}
          </label>
          {!!diagram.simulations?.length && (
            <label className="ix-select">
              <span>Live</span>
              <select value={sim} onChange={(e) => setSim(e.target.value)} data-testid="embed-sim">
                <option value="">Static diagram</option>
                {diagram.simulations.map((s) => (
                  <option key={s.id} value={s.id}>
                    Play “{s.title}”
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Disclosure>
    </Dialog>
  );
}

/** Paste a diagram: JSON, draw.io XML or Mermaid, auto-detected. */
export function PasteDialog({ onImport, onClose }: { onImport: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const format = text.trim() ? detectFormat(text) : undefined;
  const canRead = typeof navigator.clipboard?.readText === "function";
  return (
    <Dialog
      title="Paste a diagram"
      subtitle="Live Diagrams JSON, draw.io XML, a Mermaid flowchart, a docker-compose file, Kubernetes manifests, an AsyncAPI document or a Terraform plan (terraform show -json). The format is detected for you."
      icon={<Glyph name="clipboard" />}
      onClose={onClose}
      testId="paste-dialog"
      footer={
        <>
          {canRead && (
            <button
              className="btn"
              onClick={() =>
                navigator.clipboard
                  .readText()
                  .then(setText, () =>
                    toast.error("The browser didn't allow reading the clipboard. Paste with Ctrl+V instead."),
                  )
              }
              data-testid="paste-from-clipboard"
            >
              <Glyph name="clipboard" size={14} /> Read clipboard
            </button>
          )}
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="paste-cancel">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => onImport(text)}
            data-testid="paste-submit"
          >
            <Glyph name="upload" size={14} /> Import
          </button>
        </>
      }
    >
      <textarea
        className="ix-input ix-mono ix-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "flowchart LR\n  web[Web app] -->|POST /orders| api[Order API]\n  api -.->|OrderPlaced| bus[(Service Bus)]"
        }
        spellCheck={false}
        rows={12}
        aria-label="Diagram text"
        data-autofocus
        data-testid="paste-input"
      />
      <div className="ix-meta-row">
        <span className={`ix-badge${format ? " is-on" : ""}`} data-testid="paste-format">
          {text.trim() ? (format ? `Detected: ${FORMAT_LABEL[format]}` : "Unrecognised format") : "Waiting for text"}
        </span>
      </div>
    </Dialog>
  );
}

/** Open a share link someone sent you. */
export function OpenLinkDialog({ onOpen, onClose }: { onOpen: (input: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <Dialog
      title="Open a share link"
      subtitle="It opens in its own “Shared” slot, so your diagrams stay as they are."
      icon={<Glyph name="link" />}
      onClose={onClose}
      testId="open-link-dialog"
      width={520}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="open-link-cancel">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!value.trim()}
            onClick={() => onOpen(value)}
            data-testid="open-link-submit"
          >
            Open
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onOpen(value);
        }}
      >
        <input
          className="ix-input ix-mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…/#d=…"
          aria-label="Share link"
          data-autofocus
          data-testid="open-link-input"
        />
      </form>
    </Dialog>
  );
}

/**
 * What Private means, and the one confirmation before it's turned off (the badge beside the title and
 * File ▸ Privacy ▸ Private diagram open it). Keeping it private is the default button.
 */
export function PrivacyDialog({ onTurnOff, onClose }: { onTurnOff: () => void; onClose: () => void }) {
  return (
    <Dialog
      title="Private diagram"
      subtitle="It stays on this device. To share it, export Interactive HTML or the diagram file."
      icon={<Glyph name="lock" />}
      onClose={onClose}
      testId="privacy-dialog"
      width={480}
      footer={
        <>
          <a className="link-btn" href="privacy.html" target="_blank" rel="noopener" data-testid="privacy-dialog-more">
            How privacy works
          </a>
          <span className="ix-grow" />
          <button className="btn" onClick={onTurnOff} data-testid="privacy-turn-off">
            Make not private
          </button>
          <button className="btn btn-primary" onClick={onClose} data-autofocus data-testid="privacy-keep">
            Keep private
          </button>
        </>
      }
    >
      <ul className="ix-privacy-list" data-testid="privacy-dialog-list">
        <li>No share links; embeds only where your own app supplies it</li>
        <li>No saves to cloud storage</li>
        <li>No AI: agents, Copy for AI and copied prompts can&apos;t read it</li>
      </ul>
      <p className="ix-muted">Made not private, it can be shared, saved to the cloud and read by AI again.</p>
    </Dialog>
  );
}

/**
 * File ▸ Privacy ▸ Clear everything on this device…: says what goes and what stays, then clears and starts over.
 * Cancel is the default button.
 */
export function ClearDeviceDialog({ onClose }: { onClose: () => void }) {
  // The wipe's code comes with this dialog: confirming clears at once, with nothing left to download (so nothing to
  // cancel, or to fail, after the click).
  return (
    <Dialog
      title="Clear everything on this device?"
      subtitle="Live Diagrams forgets everything it keeps in this browser, then starts over."
      icon={<Glyph name="alert" />}
      onClose={onClose}
      testId="clear-device-dialog"
      width={480}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn btn-danger" onClick={clearDevice} data-testid="clear-device-confirm">
            Clear everything
          </button>
          <button className="btn btn-primary" onClick={onClose} data-autofocus data-testid="clear-device-cancel">
            Cancel
          </button>
        </>
      }
    >
      <ul className="ix-privacy-list" data-testid="clear-device-list">
        <li>Every diagram in Your diagrams, private ones included, and your edits to examples</li>
        <li>A diagram opened from a link, AI conversations, and where files were saved</li>
        <li>Your settings</li>
      </ul>
      <p className="ix-muted">
        Files you saved or exported, and copies in Google Drive, OneDrive or Dropbox, stay where they are. This
        can&apos;t be undone. Other tabs of Live Diagrams start over too.
      </p>
    </Dialog>
  );
}

/** A draw.io file with several pages: pick one. */
export function PagesDialog({
  fileName,
  pages,
  onPick,
  onClose,
}: {
  fileName: string;
  pages: { name: string; index: number }[];
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Choose a page"
      subtitle={`“${fileName}” has ${pages.length} pages. Which one should open?`}
      icon={<Glyph name="drawio" />}
      onClose={onClose}
      testId="drawio-pages-dialog"
      width={460}
    >
      <div className="ix-page-list">
        {pages.map((p) => (
          <button
            key={p.index}
            className="ix-page"
            onClick={() => onPick(p.index)}
            data-testid={`drawio-page-${p.index}`}
            data-autofocus={p.index === 0 ? true : undefined}
          >
            <span className="ix-page-num">{p.index + 1}</span>
            <span className="ix-page-name">{p.name}</span>
            <Glyph name="chevron-right" size={14} />
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/** A small "Options" disclosure: secondary settings stay out of the way until asked for. */
export function Disclosure({
  testId,
  label = "Options",
  children,
}: {
  testId: string;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ix-disclosure${open ? " is-open" : ""}`}>
      <button
        className="ix-disclosure-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testId}-toggle`}
      >
        <Glyph name="chevron-right" size={12} /> {label}
      </button>
      {open && (
        <div className="ix-disclosure-body" data-testid={testId}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Image export: PNG by default, with the diagram's title; size, background, title and SVG behind Options. */
export function ImageDialog({
  onExport,
  onClose,
}: {
  onExport: (kind: "png" | "svg", opts: { scale: number; transparent: boolean; title: boolean }) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"png" | "svg">("png");
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [title, setTitle] = useState(true);
  const summary =
    (kind === "svg" ? "SVG, scalable" : `PNG, ${scale}× resolution${transparent ? ", transparent background" : ""}`) +
    (title ? "" : ", without the title");
  return (
    <Dialog
      title="Export image"
      subtitle="The whole diagram at full size, whatever part of it is on screen."
      icon={<Glyph name="image" />}
      onClose={onClose}
      testId="image-dialog"
      width={440}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="image-cancel">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onExport(kind, { scale, transparent, title })}
            data-testid="image-export"
            data-autofocus
          >
            <Glyph name="download" size={14} /> Download {kind.toUpperCase()}
          </button>
        </>
      }
    >
      <div className="ix-meta-row" data-testid="image-summary">
        {summary}
      </div>
      <Disclosure testId="image-options">
        <div className="ix-form">
          <span className="ix-form-label">Format</span>
          <div className="ix-seg" role="radiogroup" aria-label="Format">
            {(["png", "svg"] as const).map((k) => (
              <button
                key={k}
                role="radio"
                aria-checked={kind === k}
                className={kind === k ? "is-on" : ""}
                onClick={() => setKind(k)}
                data-testid={`image-format-${k}`}
              >
                {k.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="ix-form-label">Title</span>
          <label className="ix-check">
            <input
              type="checkbox"
              checked={title}
              onChange={(e) => setTitle(e.target.checked)}
              data-testid="image-title"
            />
            Diagram title and description
          </label>
          {kind === "png" && (
            <>
              <span className="ix-form-label">Resolution</span>
              <div className="ix-seg" role="radiogroup" aria-label="Resolution">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={scale === n}
                    className={scale === n ? "is-on" : ""}
                    onClick={() => setScale(n)}
                    data-testid={`image-scale-${n}`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
              <span className="ix-form-label">Background</span>
              <label className="ix-check">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                  data-testid="image-transparent"
                />
                Transparent
              </label>
            </>
          )}
        </div>
      </Disclosure>
    </Dialog>
  );
}
