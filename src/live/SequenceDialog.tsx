import { useMemo } from "react";
import type { DiagramFile } from "../model/types";
import type { MessageTrace } from "../sim/types";
import { Dialog } from "../interop/ui/Dialog";
import { Glyph } from "../interop/ui/glyphs";
import { copyText } from "../interop/ui/copyText";
import { downloadBlob, downloadDataUrl, slugify } from "../interop/files";
import { svgToPng } from "../interop/image";
import { toast } from "../interop/ui/toast";
import { buildSequence } from "../trace/sequence";
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
  const picture = useMemo(() => toSvg(model, SEQUENCE_THEMES[theme], measureText), [model, theme]);
  const file = `${slugify(diagram.title)}-${slugify(model.title)}-sequence`;

  const copyMermaid = async () => {
    const ok = await copyText(toMermaid(model));
    if (ok) toast.success("Copied the sequence diagram as Mermaid.");
    else toast.error("The browser didn't allow copying. Try again, or download the SVG.");
  };
  const downloadSvg = () => downloadBlob(new Blob([picture.svg], { type: "image/svg+xml" }), `${file}.svg`);
  const downloadPng = async () => {
    try {
      await downloadDataUrl(await svgToPng(picture.svg, picture.width, picture.height, 2), `${file}.png`);
    } catch {
      toast.error("Couldn't render the PNG. Download the SVG instead.");
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
      width={1180}
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
        className="tr-seq"
        data-testid="sequence-view"
        role="region"
        aria-label="Sequence diagram"
        // Scrollable both ways: keyboard users scroll it with the arrow keys.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        data-participants={model.participants.length}
        data-arrows={model.items.filter((i) => i.kind === "arrow").length}
        // The SVG is built from escaped text (src/trace/svg.ts), never from raw markup.
        dangerouslySetInnerHTML={{ __html: picture.svg }}
      />
    </Dialog>
  );
}
