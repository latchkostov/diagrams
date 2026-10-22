import type { RenderOverlay } from "../particleRenderer";
import type { SlowFrame } from "./script";

// What the live view holds for slow motion's drawing. The painter itself (painter.ts) downloads with slow motion's
// script (scriptChunk.ts); until it arrives nothing has a frame to draw, so a stand-in dims the background and
// draws nothing, exactly as the painter does without a frame.

/** Background traffic while slow motion plays: still and faint. */
export const BACKGROUND_ALPHA = 0.12;

export interface PaintedLabel {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "caption" | "offset" | "retry";
  opacity: number;
  fontSize: number;
}

/** The painter as the renderers and the live view use it (painter.ts's SlowPainter, or its stand-in). */
export interface SlowOverlay extends RenderOverlay {
  revision: number;
  frame: SlowFrame | null;
  textScale: number;
  labels: readonly PaintedLabel[];
  show(frame: SlowFrame | null, textScale?: number): void;
  reset(): void;
}

/** Until the painter's code arrives: the painter with no frame. */
export function waitingOverlay(): SlowOverlay {
  return {
    backgroundAlpha: BACKGROUND_ALPHA,
    frame: null,
    textScale: 1,
    revision: 0,
    labels: [],
    show(frame, textScale = 1) {
      if (frame !== this.frame || textScale !== this.textScale) this.revision++;
      this.frame = frame;
      this.textScale = textScale;
    },
    reset() {
      this.revision++;
    },
    paint() {},
  };
}
