/** Parses a computed `stroke-dasharray` ("5px, 5px", "none") into numbers. */
export function parseDash(value: string): number[] {
  if (!value || value === "none") return [];
  const out = value
    .split(/[\s,]+/)
    .map((v) => parseFloat(v))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return out.some((n) => n > 0) ? out : [];
}
