import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import type { DiagramFile } from "../model/types";
import type { MessageTrace } from "../sim/types";
import { Dialog } from "../interop/ui/Dialog";
import { Glyph } from "../interop/ui/glyphs";
import { copyText } from "../interop/ui/copyText";
import { createFileWriter, dataUrlToBlob, downloadBlob, slugify } from "../interop/files";
import { svgToPng } from "../interop/image";
import { toast } from "../interop/ui/toast";
import { buildSequence } from "../trace/sequence";
import { formatOffset } from "../trace/journey";
import { toMermaid } from "../trace/mermaid";
import { SEQUENCE_THEMES, toSvg, type Measure } from "../trace/svg";
import { LiveIcon } from "./icons";

let canvas: HTMLCanvasElement | undefined;
/** Real text widths in the app's fonts, so labels fit their boxes exactly. */
const measureText: Measure = (text, size, opts = {}) => {
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * size * 0.56;
  const family = opts.mono
    ? `"Geist Mono Variable", ui-monospace, monospace`
    : `"Mona Sans Variable", ui-sans-serif, system-ui, sans-serif`;
  ctx.font = `${opts.bold ? 600 : 400} ${size}px ${family}`;
  return ctx.measureText(text).width;
};

/** Narrower than this and a wide journey scrolls at full size instead of shrinking to fit. */
const MIN_FIT = 0.8;
/** The dialog's padding, the view's border and its vertical scrollbar, around the picture. */
const CHROME_X = 42 + 16;

const onResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewportWidth = () => window.innerWidth;

/**
 * "Sequence": the traced message's whole journey (every fan-out copy from the root) as a sequence
 * diagram, drawn from the same SVG that's downloaded. Copy as Mermaid is the primary action.
 */
export function SequenceDialog({
  trace,
  diagram,
  theme,
  onClose,
}: {
  trace: MessageTrace;
  diagram: DiagramFile;
  theme: "light" | "dark";
  onClose(): void;
}) {
  const model = useMemo(() => buildSequence(trace, diagram), [trace, diagram]);
  const participantName = (id: string) => model.participants.find((p) => p.id === id)?.label ?? id;
  const picture = useMemo(() => toSvg(model, SEQUENCE_THEMES[theme], measureText), [model, theme]);
  const file = `${slugify(diagram.title)}-${slugify(model.title)}-sequence`;

  // As wide as the journey needs (up to the window). A journey a little too wide shrinks to fit;
  // a much wider one scrolls at full size, with the participants pinned while it scrolls down.
  const vw = useSyncExternalStore(onResize, viewportWidth, () => 1280);
  const room = vw - 32 - CHROME_X;
  const fit = room / picture.width;
  const scale = fit >= 1 ? 1 : fit >= MIN_FIT ? fit : 1;
  const dialogWidth = Math.max(640, Math.ceil(picture.width * scale + CHROME_X));
  const view = useRef<HTMLDivElement>(null);
  // Always open at the start of the journey: the first participant and the first arrow.
  useLayoutEffect(() => {
    view.current?.scrollTo({ left: 0, top: 0 });
  }, [picture]);

  const copyMermaid = async () => {
    const ok = await copyText(toMermaid(model));
    if (ok) toast.success("Copied the sequence diagram as Mermaid.");
    else toast.error("The browser didn't allow copying. Try again, or download the SVG.");
  };
  const downloadSvg = () => downloadBlob(new Blob([picture.svg], { type: "image/svg+xml" }), `${file}.svg`);
  const downloadPng = async () => {
    const writer = createFileWriter();
    try {
      const png = await svgToPng(picture.svg, picture.width, picture.height, 2);
      writer.blob(dataUrlToBlob(png), `${file}.png`);
    } catch {
      if (!writer.signal.aborted) toast.error("Couldn't render the PNG. Download the SVG instead.");
    } finally {
      writer.finish();
    }
  };

  return (
    <Dialog
      title="Sequence diagram"
      subtitle={
        <>
          The whole journey of {model.title}, every copy included, in the order things happened.
          {model.done ? "" : " It's still travelling: this is the journey so far."}
        </>
      }
      icon={<LiveIcon name="sequence" size={16} />}
      onClose={onClose}
      testId="sequence-dialog"
      width={dialogWidth}
      footer={
        <>
          <button className="btn" onClick={downloadSvg} data-testid="sequence-download-svg">
            <Glyph name="download" size={14} /> SVG
          </button>
          <button className="btn" onClick={() => void downloadPng()} data-testid="sequence-download-png">
            <Glyph name="image" size={14} /> PNG
          </button>
          <span className="ix-grow" />
          <button
            className="btn btn-primary"
            onClick={() => void copyMermaid()}
            data-testid="sequence-copy-mermaid"
            data-autofocus
          >
            <Glyph name="copy" size={14} /> Copy as Mermaid
          </button>
        </>
      }
    >
      <div
        ref={view}
        className="tr-seq"
        data-testid="sequence-view"
        role="region"
        aria-label="Sequence diagram"
        // Scrollable both ways: keyboard users scroll it with the arrow keys.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        data-participants={model.participants.length}
        data-arrows={model.items.filter((i) => i.kind === "arrow").length}
        data-scale={scale.toFixed(3)}
        style={
          {
            "--seq-w": `${picture.width * scale}px`,
            "--seq-head-h": `${picture.headerHeight * scale}px`,
            "--seq-band-top": `${picture.bandTop * scale}px`,
          } as CSSProperties
        }
      >
        {/* The participants, pinned at the top while the journey scrolls under them. */}
        <div
          className="tr-seq-head"
          data-testid="sequence-header"
          // Built from escaped text (src/trace/svg.ts), never from raw markup.
          dangerouslySetInnerHTML={{ __html: picture.header }}
        />
        {/* The SVG is built from escaped text (src/trace/svg.ts), never from raw markup. */}
        <div className="tr-seq-body" dangerouslySetInnerHTML={{ __html: picture.svg }} />
      </div>
      <section className="sr-only" aria-label="Sequence details" data-testid="sequence-accessible">
        <h3>Participants</h3>
        <ul data-testid="sequence-participants">
          {model.participants.map((p) => (
            <li key={p.id}>{p.label}</li>
          ))}
        </ul>
        <h3>Messages and timing</h3>
        <ol data-testid="sequence-messages">
          {model.items.map((item, i) => (
            <li key={i}>
              {formatOffset(item.t)}:{" "}
              {item.kind === "arrow"
                ? `${participantName(item.from)} → ${participantName(item.to)}: ${item.label} (${item.style}), arrives ${formatOffset(item.until)}${item.detail ? `. ${item.detail}` : ""}`
                : item.kind === "note"
                  ? `${participantName(item.over)}: ${item.text}`
                  : `${item.node ? `${participantName(item.node)}: ` : ""}${item.text}`}
            </li>
          ))}
        </ol>
      </section>
    </Dialog>
  );
}
