/** Icons fill a tiny card's height, otherwise retain at least fourteen screen pixels. */
export function iconDetail(size: number, height: number, zoom: number) {
  return Math.min(height, Math.max(size, 14 / zoom));
}

/** Fit actual glyphs, including the ellipsis; use word initials in very narrow cards. */
export function titleText(name: string, width: number, measure: (text: string) => number) {
  const text = name.trim();
  if (measure(text) <= width) return text;
  const chars = [...text];
  while (chars.length > 1) {
    chars.pop();
    const short = `${chars.join("").trimEnd()}…`;
    if (measure(short) <= width) return short;
  }
  const short = text.split(/\s+/u).map((word) => [...word][0]);
  while (short.length > 1 && measure(short.join("")) > width) short.pop();
  return short.join("");
}
