import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DiagramFile } from "../../model/types";
import { embedSnippet, embedUrl, encodeShare, SHARE_WARN_LENGTH, shareUrl } from "../share";
import { detectFormat, FORMAT_LABEL } from "../formats";
import { copyText, Dialog } from "./Dialog";
import { Glyph } from "./glyphs";
import { toast } from "./toast";

const kb = (n: number) => (n < 1024 ? `${n} characters` : `${(n / 1024).toFixed(1)}k characters`);

/** Share link: the diagram compressed into the URL fragment. */
export function ShareDialog({ diagram, onClose }: { diagram: DiagramFile; onClose: () => void }) {
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

  const copy = async () => {
    if (url && (await copyText(url))) toast.success("Share link copied.");
    else toast.error("Couldn't copy automatically. Select the link and copy it.");
  };

  return (
    <Dialog
      title="Share link"
      subtitle="Anyone with the link gets their own editable copy."
      icon={<Glyph name="link" />}
      onClose={onClose}
      testId="share-link-dialog"
      footer={
        <>
          {canShare && url && (
            <button
              className="btn"
              onClick={() => navigator.share({ title: diagram.title, url }).catch(() => {})}
              data-testid="share-link-native"
            >
              <Glyph name="share" size={14} /> Share…
            </button>
          )}
          <span className="ix-grow" />
          {url && (
            <a className="btn" href={url} target="_blank" rel="noopener" data-testid="share-link-open">
              <Glyph name="external" size={14} /> Open
            </a>
          )}
          <button
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

/** Embed code: an <iframe> of the read-only viewer, with a live preview. */
export function EmbedDialog({
  diagram,
  example,
  onClose,
}: {
  diagram: DiagramFile;
  example?: string;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<string>();
  const [byName, setByName] = useState(!!example);
  const [height, setHeight] = useState(480);
  const [sim, setSim] = useState("");
  useEffect(() => {
    let live = true;
    encodeShare(diagram).then((p) => live && setPayload(p));
    return () => {
      live = false;
    };
  }, [diagram]);
  const src = useMemo(() => {
    if (byName && example) return embedUrl({ example, live: !!sim, sim: sim || undefined });
    return payload ? embedUrl({ payload, live: !!sim, sim: sim || undefined }) : undefined;
  }, [byName, example, payload, sim]);
  const snippet = src ? embedSnippet(src, { title: diagram.title, height }) : "";
  const [previewSrc, setPreviewSrc] = useState<string>();
  useEffect(() => {
    // Debounce so flipping options doesn't reload the preview on every click.
    const t = setTimeout(() => setPreviewSrc(src), 250);
    return () => clearTimeout(t);
  }, [src]);

  const copy = async () => {
    if (snippet && (await copyText(snippet))) toast.success("Embed code copied.");
    else toast.error("Couldn't copy automatically. Select the code and copy it.");
  };

  return (
    <Dialog
      title="Embed"
      subtitle="Paste this into a blog post, wiki or docs page. Viewers can pan and zoom, not edit."
      icon={<Glyph name="code" />}
      onClose={onClose}
      testId="embed-dialog"
      width={720}
      footer={
        <>
          <span className="ix-grow" />
          {src && (
            <a className="btn" href={src} target="_blank" rel="noopener" data-testid="embed-open">
              <Glyph name="external" size={14} /> Open viewer
            </a>
          )}
          <button
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
      <textarea
        className="ix-input ix-mono ix-code"
        readOnly
        value={snippet}
        rows={4}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Embed code"
        data-testid="embed-snippet"
      />
      <div className="ix-preview" style={{ height: Math.min(height, 340) }}>
        {previewSrc ? (
          <iframe src={previewSrc} title="Embed preview" loading="lazy" data-testid="embed-preview" />
        ) : (
          <span className="ix-muted">Preparing preview…</span>
        )}
      </div>
      <Disclosure testId="embed-options">
        <div className="ix-options">
          {example && (
            <div className="ix-seg" role="radiogroup" aria-label="What to embed">
              <button
                role="radio"
                aria-checked={byName}
                className={byName ? "is-on" : ""}
                onClick={() => setByName(true)}
                data-testid="embed-source-example"
              >
                Example by name
              </button>
              <button
                role="radio"
                aria-checked={!byName}
                className={!byName ? "is-on" : ""}
                onClick={() => setByName(false)}
                data-testid="embed-source-inline"
              >
                This exact diagram
              </button>
            </div>
          )}
          <label className="ix-select">
            <span>Height</span>
            <select value={height} onChange={(e) => setHeight(Number(e.target.value))} data-testid="embed-height">
              {[360, 480, 640, 800].map((h) => (
                <option key={h} value={h}>
                  {h}px
                </option>
              ))}
            </select>
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
      subtitle="Diagrams JSON, draw.io XML or a Mermaid flowchart. The format is detected for you."
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

/** Image export: PNG by default; size, background and SVG behind Options. */
export function ImageDialog({
  onExport,
  onClose,
}: {
  onExport: (kind: "png" | "svg", opts: { scale: number; transparent: boolean }) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"png" | "svg">("png");
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const summary =
    kind === "svg" ? "SVG, scalable" : `PNG, ${scale}× resolution${transparent ? ", transparent background" : ""}`;
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
            onClick={() => onExport(kind, { scale, transparent })}
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
