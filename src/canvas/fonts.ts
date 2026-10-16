/** Explicitly load each face used by rendered text, including weights/unicode subsets that
 * fonts.ready alone need not have requested yet. Shared with the browser parity reader. */
export async function readyFonts(root: HTMLElement): Promise<void> {
  const used = new Map<string, string>();
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("");
    if (!text.trim()) continue;
    const s = getComputedStyle(el);
    const font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    used.set(font, (used.get(font) ?? "") + text);
  }
  await Promise.all([...used].map(([font, text]) => document.fonts.load(font, text)));
  await document.fonts.ready;
}
