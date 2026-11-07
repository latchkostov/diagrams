import { parseNative, validateDiagram, type NativeResult, LIMITS } from "./native";
import { t } from "../i18n/core";

// Transient provenance, never serialized into a diagram or its unknown-field envelope.
const laidOut = new WeakSet<object>();
export const wasLaidOutOnOpen = (diagram: object): boolean => laidOut.has(diagram);

/** File and link ingress share this path; the layout engine downloads only for missing positions. */
export async function parseOpenedNative(text: string): Promise<NativeResult> {
  const original = parseNative(text);
  if (original.ok || text.length > LIMITS.maxTextChars) return original;
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return original;
  }
  if (!raw || typeof raw !== "object" || !("nodes" in raw) || !Array.isArray(raw.nodes)) return original;
  let missing = false;
  for (const node of raw.nodes as unknown[]) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return original;
    const n = node as Record<string, unknown>;
    for (const axis of ["x", "y"]) {
      if (!Object.hasOwn(n, axis)) missing = true;
      else if (!Number.isFinite(n[axis])) return original;
    }
  }
  if (!missing) return original;
  const { layoutDiagram } = await import("../ai/skill/layout");
  const result = layoutDiagram(raw);
  if (!result.ok) return result;
  const checked = validateDiagram(result.diagram);
  if (checked.ok) {
    laidOut.add(checked.diagram);
    checked.warnings.unshift(t("fileToast.laidOutOnOpen"));
  }
  return checked;
}
