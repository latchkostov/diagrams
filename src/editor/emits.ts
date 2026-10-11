// Text form of NodeSimProps.emits, as typed in the inspector.

/**
 * `emits` text → value: "" = unset, "Name" = one type, "A → B, * → C" (or "->", or JSON) = map.
 * Returns null while a map is still incomplete, so the draft is kept until it parses.
 */
export function parseEmits(raw: string): string | Record<string, string> | undefined | null {
  const t = raw.trim();
  if (!t) return undefined;
  if (t.startsWith("{")) {
    try {
      const obj = JSON.parse(t) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj) && Object.values(obj).every((v) => typeof v === "string"))
        return obj as Record<string, string>;
    } catch {
      // fall through
    }
    return null;
  }
  if (!/→|->/.test(t)) return t;
  const map: Record<string, string> = {};
  for (const part of t.split(",")) {
    if (!part.trim()) continue;
    const [from, to, ...rest] = part.split(/→|->/).map((x) => x.trim());
    if (!from || !to || rest.length) return null;
    map[from] = to;
  }
  return Object.keys(map).length ? map : null;
}
