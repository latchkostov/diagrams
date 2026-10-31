import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from "react";
import type { DiagramFile } from "../model/types";
import type { MessageTrace } from "../sim/types";
import { Dialog } from "../interop/ui/Dialog";
import { Glyph } from "../interop/ui/glyphs";
import { copyText } from "../interop/ui/copyText";
import { dataUrlToBlob, slugify } from "../interop/files";
import { svgToPng } from "../interop/image";
import { toast } from "../interop/ui/toast";
import { buildSequence } from "../trace/sequence";
import { formatOffset } from "../trace/journey";
import { toMermaid } from "../trace/mermaid";
import { SEQUENCE_THEMES, toSvg, type Measure } from "../trace/svg";
import { LiveIcon } from "./icons";

import { createSequenceExporter } from "./sequenceExport";
import { currentObservationSource } from "../palette/observationSource";
import { observationPorts } from "../lib/observations";
import { t } from "../i18n";

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

  const exporter = useRef<ReturnType<typeof createSequenceExporter> | null>(null);
  const arrows = model.items.filter((i) => i.kind === "arrow").length;
  useLayoutEffect(() => {
    const owner = createSequenceExporter(trace.rootId);
    exporter.current = owner;
    const source = currentObservationSource();
    if (source) observationPorts.sequence.publish({ ...source, traceId: trace.rootId, open: true, arrows });
    return () => {
      owner.cancel();
      if (exporter.current === owner) exporter.current = null;
      if (source) observationPorts.sequence.publish({ ...source, traceId: trace.rootId, open: false, arrows });
    };
  }, [trace.rootId, arrows]);
  const exportSequence = async (format: "svg" | "mermaid" | "png", owner = exporter.current) => {
    if (!owner) return;
    const result = await owner.run(format, async (writer, check) => {
      if (format === "mermaid") {
        const text = toMermaid(model);
        if (!(await copyText(text))) throw new Error("Copy refused");
        check();
        return new Blob([text]).size;
      }
      const blob =
        format === "svg"
          ? new Blob([picture.svg], { type: "image/svg+xml" })
          : dataUrlToBlob(await svgToPng(picture.svg, picture.width, picture.height, 2));
      check();
      writer.blob(blob, `${file}.${format}`);
      return blob.size;
    });
    if (result.status === "failure")
      toast.error(t("planning.sequence.exportFailed"), {
        action: {
          label: t("common.retry"),
          run: () => void exportSequence(format, owner),
          testId: "sequence-export-retry",
        },
      });
    else if (result.status === "success" && format === "mermaid") toast.success(t("planning.sequence.copied"));
  };

  return (
    <Dialog
      title={t("planning.sequence.title")}
      subtitle={
        <>
          {t("planning.sequence.subtitle", { title: model.title })}
          {model.done ? "" : t("planning.sequence.travelling")}
        </>
      }
      icon={<LiveIcon name="sequence" size={16} />}
      onClose={onClose}
      testId="sequence-dialog"
      width={dialogWidth}
      footer={
        <>
          <button className="btn" onClick={() => void exportSequence("svg")} data-testid="sequence-download-svg">
            <Glyph name="download" size={14} /> SVG
          </button>
          <button className="btn" onClick={() => void exportSequence("png")} data-testid="sequence-download-png">
            <Glyph name="image" size={14} /> PNG
          </button>
          <span className="ix-grow" />
          <button
            className="btn btn-primary"
            onClick={() => void exportSequence("mermaid")}
            data-testid="sequence-copy-mermaid"
            data-autofocus
          >
            <Glyph name="copy" size={14} /> {t("planning.sequence.copy")}
          </button>
        </>
      }
    >
      <div
        ref={view}
        className="tr-seq"
        data-testid="sequence-view"
        data-trace={trace.rootId}
        role="region"
        aria-label={t("planning.sequence.title")}
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
      <section className="sr-only" aria-label={t("planning.sequence.details")} data-testid="sequence-accessible">
        <h3>{t("planning.sequence.participants")}</h3>
        <ul data-testid="sequence-participants">
          {model.participants.map((p) => (
            <li key={p.id}>{p.label}</li>
          ))}
        </ul>
        <h3>{t("planning.sequence.timing")}</h3>
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
