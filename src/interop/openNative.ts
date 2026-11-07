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
  const missing = raw.nodes.some((node: unknown) => {
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    return !Number.isFinite(n.x) || !Number.isFinite(n.y);
  });
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
