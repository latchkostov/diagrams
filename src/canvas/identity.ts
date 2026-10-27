/** Icons fill a tiny card's height, otherwise retain at least fourteen screen pixels. */
export function iconDetail(size: number, height: number, zoom: number) {
  return Math.min(height, Math.max(size, 14 / zoom));
}

/** Fit actual glyphs, including the ellipsis; use word initials in very narrow cards. */
export function titleText(name: string, width: number, measure: (text: string) => number) {
  const text = name.trim();
  // Imported labels are unbounded. Keep stored words intact, but never send an
  // unbounded string to the font shaper (including on the initial fit check).
  const chars = [...text.slice(0, 512)].slice(0, 256);
  if (!chars.length) return "";
  const cache = new Map<string, number>();
  const measured = (value: string) => {
    let size = cache.get(value);
    if (size === undefined) cache.set(value, (size = measure(value)));
    return size;
  };
  const bounded = chars.join("");
  if (bounded.length === text.length && measured(bounded) <= width) return bounded;
  const fit = (letters: string[], suffix: string) => {
    let low = 0;
    let high = letters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = `${letters.slice(0, middle).join("").trimEnd()}${suffix}`;
      if (measured(candidate) <= width) low = middle;
      else high = middle - 1;
    }
    return low ? `${letters.slice(0, low).join("").trimEnd()}${suffix}` : "";
  };
  const shortened = fit(chars, "…");
  if (shortened) return shortened;
  const initials = text
    .split(/\s+/u)
    .slice(0, 256)
    .map((word) => String.fromCodePoint(word.codePointAt(0)!));
  return fit(initials, "") || chars[0] || "";
}
