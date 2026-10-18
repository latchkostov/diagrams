/** "8", "500 ms", or the JSON of anything else. */
export function formatInert(value: unknown, unit?: string): string {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : JSON.stringify(value);
  return unit && typeof value === "number" ? `${text} ${unit}` : text;
}

export const customCount = (props: Record<string, unknown>, hidden: Set<string>) =>
  Object.keys(props).filter((k) => !hidden.has(k)).length;
