// Node card sizing rules, shared by the CSS (.nb-card in app.css), auto-layout and tests.
// Cards grow with their text from MIN to MAX width; longer labels truncate with an ellipsis and
// sublabels wrap onto two lines, so a card never outgrows its column.

export const CARD = {
  minWidth: 220,
  maxWidth: 260,
  height: 72,
  /** Left padding + icon tile + gap + right padding. */
  chrome: 13 + 44 + 12 + 14,
  /** Average advance of the 13.5px label font, and the exact advance of the 10.5px mono sublabel. */
  labelChar: 7.5,
  subChar: 6.3,
} as const;

/** Estimated rendered card size before React Flow has measured it. */
export function estimateCardSize(label: string, sublabel?: string): { width: number; height: number } {
  const room = CARD.maxWidth - CARD.chrome;
  const labelW = label.length * CARD.labelChar;
  const subW = Math.min((sublabel?.length ?? 0) * CARD.subChar, room);
  const width = Math.round(Math.min(CARD.maxWidth, Math.max(CARD.minWidth, CARD.chrome + Math.max(labelW, subW))));
  return { width, height: CARD.height };
}
